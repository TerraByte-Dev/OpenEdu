import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LLMProvider } from "../types";

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
  onGoSettings: () => void;
}

export default function Titlebar({ provider, onGoSettings }: TitlebarProps) {
  const win = getCurrentWindow();

  return (
    <div
      className="flex items-center h-8 shrink-0 border-b border-[var(--rule)] bg-panel select-none"
      style={{ zIndex: 200, position: "relative" }}
      data-tauri-drag-region
    >
      {/* Left: brand */}
      <div className="flex items-center px-3 shrink-0" data-tauri-drag-region>
        <span
          className="text-[11px] font-mono text-phosphor-ink uppercase tracking-widest"
          data-tauri-drag-region
        >
          OpenEdu
        </span>
      </div>

      {/* Center: drag region (fills remaining space) */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Right: provider indicator + settings */}
      <div className="flex items-center gap-2 px-3 shrink-0">
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: PROVIDER_DOT[provider],
              boxShadow: `0 0 6px ${PROVIDER_DOT[provider]}`,
            }}
          />
          <span className="text-[10px] font-mono text-[var(--ink-faint)] uppercase tracking-wider">
            {PROVIDER_LABEL[provider]}
          </span>
        </span>
        <button
          onClick={onGoSettings}
          className="p-0.5 text-[var(--ink-faint)] hover:text-phosphor-ink transition-colors"
          title="Settings"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
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
