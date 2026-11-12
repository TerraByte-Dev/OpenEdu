// Guided Ollama setup (#275). Shown by SetupGate while Ollama is missing or stopped.
//
// The words come from `ollamaGuidance` (pure, tested). This file only lays them out and runs the one
// action that needs Rust: pointing at the stick that has Ollama's installer. The app never runs that
// installer. It shows the folder as text instead of opening a file window, because opening one needs a
// shell/opener permission this app deliberately doesn't have.

import { useState } from "react";
import { pickInstallerFolder, type InstallerFolder } from "../lib/model-import";
import { formatBytes } from "../lib/model-kit";
import type { Guidance } from "../lib/ollama-guide";

export default function OllamaGuide({ guidance, onRecheck, busy }: { guidance: Guidance; onRecheck: () => void; busy?: boolean }) {
  const [found, setFound] = useState<InstallerFolder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [copied, setCopied] = useState(false);

  const findInstaller = async () => {
    setError(null);
    setLooking(true);
    try {
      const r = await pickInstallerFolder();
      if (r) { setFound(r); setCopied(false); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLooking(false);
    }
  };

  const where = found?.installers[0]?.location ?? found?.folder ?? "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(where); setCopied(true); } catch { /* the path is on screen either way */ }
  };

  return (
    <div className="kit-card">
      <h2 className="text-lg text-[var(--ink-em)] font-medium">{guidance.title}</h2>
      <p className="text-sm text-[var(--ink-dim)] leading-relaxed mt-1.5">{guidance.body}</p>

      {guidance.steps.length > 0 && (
        <ol className="kit-steps mt-4">
          {guidance.steps.map((s, i) => (
            <li key={i}><span className="kit-step-n" aria-hidden>{i + 1}</span><span>{s}</span></li>
          ))}
        </ol>
      )}

      {found && (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--rule)] bg-lcd px-4 py-3">
          {found.installers.length > 0 ? (
            <>
              <p className="text-sm text-ink">
                Found <strong>{found.installers[0].name}</strong>
                {found.installers[0].bytes ? <span className="text-[var(--ink-faint)]"> · {formatBytes(found.installers[0].bytes)}</span> : null}.
                Open this folder in your file manager and double-click it:
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="font-lcd text-sm text-ink break-all flex-1">{where}</code>
                <button onClick={copy} className="btn text-sm shrink-0">{copied ? "Copied" : "Copy"}</button>
              </div>
              {found.installers.length > 1 && (
                <p className="text-sm text-[var(--ink-faint)] mt-2">
                  Also there: {found.installers.slice(1).map((i) => i.name).join(", ")}. Use the one for this computer.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-warning">
              No Ollama installer in <code className="font-lcd">{found.folder}</code>. Look for a file called OllamaSetup.exe
              (Windows) or Ollama.dmg (Mac), usually in a folder named <code className="font-lcd">ollama</code>.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger bg-danger-tint border border-danger/30 rounded-[var(--radius-control)] px-3 py-2">{error}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-5">
        {guidance.actions.map((a, i) => {
          const cls = `btn text-sm ${i === 0 ? "btn-primary" : ""}`;
          if (a === "recheck") return <button key={a} onClick={onRecheck} disabled={busy} className={cls}>Check again</button>;
          if (a === "find-installer") {
            return (
              <button key={a} onClick={findInstaller} disabled={looking || busy} className={cls}>
                {looking ? "Looking…" : found ? "Look in another folder" : "Find the Ollama installer"}
              </button>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
