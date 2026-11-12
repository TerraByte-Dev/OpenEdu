import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LLMProvider } from "../types";
import { applyTheme } from "../lib/theme";
import { useThemeState } from "../lib/useTheme";

const PROVIDER_LABEL: Record<LLMProvider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const PROVIDER_DOT: Record<LLMProvider, string> = {
  ollama: "#4ade80",
  openai: "#60a5fa",
  anthropic: "#c084fc",
};

interface TitlebarProps {
  provider: LLMProvider;
  /** Omitted while the learner picker is up: settings open from inside a learner's session. */
  onGoSettings?: () => void;
  /** The active learner's name, shown when there is a picker; the chip opens Switch learner and the learner's own controls. */
  learnerName?: string;
  onOpenLearner?: () => void;
}

export default function Titlebar({ provider, onGoSettings, learnerName, onOpenLearner }: TitlebarProps) {
  const win = getCurrentWindow();

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
          OpenEdu
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
            </svg>
            <span className="text-xs truncate">{learnerName}</span>
          </button>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: PROVIDER_DOT[provider] }}
          />
          <span className="text-xs text-[var(--ink-faint)]">
            {PROVIDER_LABEL[provider]}
          </span>
        </span>
        <button
          onClick={toggleTheme}
          className="p-0.5 text-[var(--ink-faint)] hover:text-phosphor transition-colors"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            // Sun: shown in dark mode, switches to light.
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            // Moon: shown in light mode, switches to dark.
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        {onGoSettings && <button
          onClick={onGoSettings}
          className="p-0.5 text-[var(--ink-faint)] hover:text-phosphor-ink transition-colors"
          title="Settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
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
