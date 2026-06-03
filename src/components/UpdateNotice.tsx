import { useEffect, useRef, useState } from "react";
import { checkForUpdate, installUpdate, type Update } from "../lib/updater";

type State =
  | { kind: "hidden" }
  | { kind: "available"; update: Update }
  | { kind: "installing"; pct: number | null }
  | { kind: "error"; msg: string };

// Silent update check shortly after launch. If a signed update is available, shows a dismissible banner
// with one-click install + relaunch. Failures (offline / no release yet / dev) are swallowed — no banner.
export function UpdateNotice() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const t = setTimeout(async () => {
      try {
        const upd = await checkForUpdate();
        if (upd && mounted.current) setState({ kind: "available", update: upd });
      } catch { /* offline / no release / dev — stay hidden */ }
    }, 3000);
    return () => { mounted.current = false; clearTimeout(t); };
  }, []);

  if (state.kind === "hidden") return null;

  const install = async (update: Update) => {
    setState({ kind: "installing", pct: null });
    try {
      await installUpdate(update, (pct) => { if (mounted.current) setState({ kind: "installing", pct }); });
      // app relaunches on success
    } catch (e) {
      if (mounted.current) setState({ kind: "error", msg: e instanceof Error ? e.message : "Update failed." });
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--rule)] text-sm shrink-0"
      style={{ background: "rgb(var(--phosphor-rgb)/0.08)", zIndex: 150 }}
    >
      <span className="w-2 h-2 rounded-full bg-phosphor animate-pulse shrink-0" />
      {state.kind === "available" && (
        <>
          <span className="text-phosphor-ink">A new version is available — <strong>v{state.update.version}</strong>.</span>
          <button onClick={() => install(state.update)} className="btn btn-primary text-xs ml-1">Install &amp; restart</button>
          <button onClick={() => setState({ kind: "hidden" })} className="ml-auto text-[var(--ink-faint)] hover:text-ink text-xs">Later</button>
        </>
      )}
      {state.kind === "installing" && (
        <span className="text-phosphor-bright">
          {state.pct == null ? "Downloading update…" : state.pct < 100 ? `Downloading update… ${state.pct}%` : "Installing & restarting…"}
        </span>
      )}
      {state.kind === "error" && (
        <>
          <span className="text-red-400">Update failed: {state.msg}</span>
          <button onClick={() => setState({ kind: "hidden" })} className="ml-auto text-[var(--ink-faint)] hover:text-ink text-xs">Dismiss</button>
        </>
      )}
    </div>
  );
}
