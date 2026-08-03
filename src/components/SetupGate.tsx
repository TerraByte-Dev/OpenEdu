// First-run setup (#92).
//
// Appears ONLY when something actually blocks using the app. A working install never sees it — an
// onboarding screen that greets people who do not need it is a tax on everyone to help someone once.
//
// Every line here is probed, not assumed. That is the whole point: the screen this replaces claimed
// "[ OK ] Ollama (local) LISTENING :11434" on machines with no Ollama installed, which sends the one
// person who most needs help off to debug a problem they do not have.

import { useState } from "react";
import { pullOllamaModel, type PullProgress } from "../lib/llm";
import type { CheckResult, SetupStatus } from "../lib/setup-check";

export interface SetupGateProps {
  status: SetupStatus;
  ollamaUrl: string;
  /** Re-probe after the user fixes something. */
  onRecheck: () => void;
  onOpenSettings: () => void;
  /** Optional checks can be skipped — the app works without them. */
  onDismiss?: () => void;
}

function formatBytes(n?: number): string {
  if (!n) return "";
  const gb = n / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

export default function SetupGate({ status, ollamaUrl, onRecheck, onOpenSettings, onDismiss }: SetupGateProps) {
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  const download = async (model: string) => {
    setPulling(model);
    setPullError(null);
    setProgress(null);
    try {
      await pullOllamaModel(model, ollamaUrl, setProgress);
      onRecheck();
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
      setProgress(null);
    }
  };

  const blocking = status.checks.filter((c) => c.severity === "blocking");

  return (
    <div className="flex-1 overflow-y-auto flex items-start justify-center p-8">
      <div className="w-full max-w-lg">
        <h1 className="text-lg text-phosphor-bright mb-1">Let's get you set up</h1>
        <p className="text-sm text-[var(--ink-dim)] mb-5">
          {blocking.length > 0
            ? "OpenEdu needs one more thing before it can tutor. Everything runs on your machine — nothing is sent anywhere."
            : "You're ready to go. These are optional."}
        </p>

        <div className="rounded-lg border border-[var(--rule)] overflow-hidden">
          {status.checks.map((check, i) => (
            <CheckRow
              key={check.id}
              check={check}
              first={i === 0}
              busy={pulling === check.fix?.arg}
              progress={pulling === check.fix?.arg ? progress : null}
              disabled={pulling !== null}
              onDownload={download}
              onOpenSettings={onOpenSettings}
            />
          ))}
        </div>

        {pullError && (
          <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {pullError}
          </p>
        )}

        <div className="flex items-center gap-2 mt-5">
          <button onClick={onRecheck} disabled={pulling !== null} className="btn text-sm disabled:opacity-50">
            Check again
          </button>
          <button onClick={onOpenSettings} disabled={pulling !== null} className="btn text-sm disabled:opacity-50">
            Settings
          </button>
          {/* Only offered when nothing is blocking — a "skip" that leads to a broken app is a trap. */}
          {status.ready && onDismiss && (
            <button onClick={onDismiss} className="ml-auto btn-primary btn text-sm">
              Start learning
            </button>
          )}
        </div>

        {blocking.length > 0 && (
          <p className="mt-4 text-[11px] text-[var(--ink-faint)] leading-relaxed">
            Prefer a cloud model? Open Settings and pick OpenAI or Anthropic instead — you'll need an
            API key, and your questions will leave this machine.
          </p>
        )}
      </div>
    </div>
  );
}

function CheckRow({
  check, first, busy, progress, disabled, onDownload, onOpenSettings,
}: {
  check: CheckResult;
  first: boolean;
  busy: boolean;
  progress: PullProgress | null;
  disabled: boolean;
  onDownload: (model: string) => void;
  onOpenSettings: () => void;
}) {
  const mark = check.severity === "ok" ? "✓" : check.severity === "blocking" ? "✕" : "–";
  const markCls =
    check.severity === "ok" ? "text-emerald-400"
      : check.severity === "blocking" ? "text-red-400"
        : "text-[var(--ink-faint)]";

  return (
    <div className={`flex items-start gap-3 px-3.5 py-3 bg-panel-lite/40 ${first ? "" : "border-t border-[var(--rule)]"}`}>
      <span className={`text-sm leading-5 w-3 shrink-0 ${markCls}`}>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-ink">{check.label}</span>
          {check.severity === "optional" && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)]">optional</span>
          )}
        </div>
        <p className="text-xs text-[var(--ink-dim)] leading-snug mt-0.5">{check.detail}</p>

        {busy && (
          <div className="mt-2">
            <div className="h-1 rounded-full bg-lcd overflow-hidden">
              <div
                className="h-full bg-phosphor transition-[width] duration-300"
                style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--ink-faint)] mt-1">
              {progress?.status || "starting…"}
              {progress?.totalBytes ? ` — ${formatBytes(progress.completedBytes)} of ${formatBytes(progress.totalBytes)}` : ""}
            </p>
          </div>
        )}

        {check.fix && !busy && (
          <div className="mt-2">
            {check.fix.kind === "download-model" && (
              <button
                onClick={() => onDownload(check.fix!.arg!)}
                disabled={disabled}
                className="btn text-xs disabled:opacity-50"
              >
                {check.fix.label}
              </button>
            )}
            {check.fix.kind === "open-settings" && (
              <button onClick={onOpenSettings} disabled={disabled} className="btn text-xs disabled:opacity-50">
                {check.fix.label}
              </button>
            )}
            {/* Deliberately NOT a link that opens a browser: this app is built for machines that may
                have no internet at all, and a dead link is worse than an instruction. */}
            {check.fix.kind === "external" && (
              <p className="text-[11px] text-[var(--ink-faint)]">
                Install it from <span className="text-phosphor-ink">ollama.com</span>, then start it and press
                Check again.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
