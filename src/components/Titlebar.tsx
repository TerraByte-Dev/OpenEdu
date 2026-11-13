import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LLMProvider } from "../types";
import { applyTheme } from "../lib/theme";
import { useThemeState } from "../lib/useTheme";
import { APP_NAME } from "../lib/product";
import { tutorStatusLabel } from "../lib/plain-language";
import type { OllamaState } from "../lib/ollama-guide";
import { IconGear, IconMoon, IconSun, IconUser } from "./icons";

interface TitlebarProps {
  provider: LLMProvider;
  /** The last setup check's Ollama state (setup-check.ts). Undefined until a check has run. */
  ollama?: OllamaState;
  /** Omitted while the learner picker is up: settings open from inside a learner's session. */
  onGoSettings?: () => void;
  /** The active learner's name, shown when there is a picker; the chip opens Switch learner and the learner's own controls. */
  learnerName?: string;
  onOpenLearner?: () => void;
}

export default function Titlebar({ provider, ollama, onGoSettings, learnerName, onOpenLearner }: TitlebarProps) {
  const win = getCurrentWindow();
  const status = tutorStatusLabel(provider, ollama);

  // Light/dark toggle. Shares state with Settings › Appearance through useThemeState. It always sets an
  // explicit mode, so a click while on "Match my computer" pins the opposite of what is showing.
  const { resolved } = useThemeState();
  const isDark = resolved === "dark";
  const toggleTheme = () => applyTheme(isDark ? "light" : "dark");

  return (
    <div
      className="flex items-center h-8 shrink-0 border-b border-[var(--rule)] bg-panel select-none"
      style={{ zIndex: 200, position: "relative" }}
      data-tauri-drag-region
    >
      {/* Left: brand */}
      <div className="flex items-center px-3 shrink-0" data-tauri-drag-region>
        <span
          className="text-xs text-phosphor-ink font-medium"
          style={{ fontFamily: "var(--font-display)" }}
          data-tauri-drag-region
        >
          {APP_NAME}
        </span>
      </div>

      {/* Center: drag region (fills remaining space) */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Right: learner + provider indicator + settings */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        {learnerName && onOpenLearner && (
          <button
            onClick={onOpenLearner}
            className="flex items-center gap-1.5 h-6 px-2 rounded border border-[var(--rule)] text-phosphor-ink hover:text-phosphor hover:border-[var(--phosphor)] transition-colors max-w-[180px]"
            title="Switch learner, add a learner, or change your name and PIN"
          >
            <IconUser size={12} className="shrink-0" />
            <span className="text-xs truncate">{learnerName}</span>
          </button>
        )}
        {status && (
          <span className="flex items-center gap-1.5">
            {status.tone === "warn" && <span className="w-1.5 h-1.5 rounded-full bg-danger" />}
            <span className={`text-xs ${status.tone === "warn" ? "text-danger" : "text-[var(--ink-faint)]"}`}>
              {status.text}
            </span>
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="p-0.5 text-[var(--ink-faint)] hover:text-phosphor transition-colors"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            // Sun: shown in dark mode, switches to light.
            <IconSun size={14} />
          ) : (
            // Moon: shown in light mode, switches to dark.
            <IconMoon size={14} />
          )}
        </button>
        {onGoSettings && <button
          onClick={onGoSettings}
          className="p-0.5 text-[var(--ink-faint)] hover:text-phosphor-ink transition-colors"
          title="Settings"
        >
          <IconGear size={13} />
        </button>}
      </div>

      {/* Windows-style window controls */}
      <div className="flex h-full shrink-0">
        <button
          onClick={() => win.minimize()}
          title="Minimize"
          className="w-[46px] h-full flex items-center justify-center text-[var(--ink-faint)] hover:text-ink transition-colors"
          style={{ background: "transparent" }}
          onMouseOver={(e) => (e.currentTarget.style.background = "rgb(var(--phosphor-rgb)/0.08)")}
          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M0 5H10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          title="Maximize"
          className="w-[46px] h-full flex items-center justify-center text-[var(--ink-faint)] hover:text-ink transition-colors"
          style={{ background: "transparent" }}
          onMouseOver={(e) => (e.currentTarget.style.background = "rgb(var(--phosphor-rgb)/0.08)")}
          onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={() => win.close()}
          title="Close"
          className="w-[46px] h-full flex items-center justify-center text-[var(--ink-faint)] transition-colors"
          style={{ background: "transparent" }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "#E81123";
            e.currentTarget.style.color = "white";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "";
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
