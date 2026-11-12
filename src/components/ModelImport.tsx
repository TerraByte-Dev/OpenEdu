// Offline model import (#275): bring a model into Ollama from a USB stick or folder, no internet.
//
// Pick → see what's there → name it → import with progress → it becomes the tutor model. Every decision
// (which files, what Ollama is told, whether the name is usable, how far along it is) is in
// lib/model-kit.ts; the bytes move in src-tauri/src/model_import.rs. This file is the screen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getOllamaModels, getOllamaVersion } from "../lib/llm";
import { setChatModel } from "../lib/store";
import { cancelModelImport, pickModelFolder, startModelImport } from "../lib/model-import";
import {
  PHASE_LABEL, candidateBytes, etaSeconds, formatBytes, formatEta, hasRoom, importFraction, licenceNotes, nameProblem,
  nameTaken, needsNewerOllama, specFor, suggestedName,
  type ImportEvent, type ImportPhase, type KitCandidate, type KitPlan,
} from "../lib/model-kit";
import { IMPORT_TARGET, isImportTarget } from "../lib/ollama-guide";

type Run =
  | { at: "idle" }
  | { at: "running"; phase: ImportPhase; done: number; total: number; file: string; started: number; skipped: number; status: string; unchecked: number }
  | { at: "done"; name: string; checked: boolean }
  | { at: "failed"; message: string };

const PHASES: ImportPhase[] = ["checking", "verifying", "copying", "finishing"];
const PHASE_SHORT: Record<ImportPhase, string> = { checking: "Room", verifying: "Check", copying: "Copy", finishing: "Ready" };

export default function ModelImport({ ollamaUrl, onImported }: { ollamaUrl: string; onImported: (name: string) => void }) {
  const [plan, setPlan] = useState<KitPlan | null>(null);
  const [choice, setChoice] = useState(0);
  const [name, setName] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  const [ollamaVersion, setOllamaVersion] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [run, setRun] = useState<Run>({ at: "idle" });
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  // Set on mount as well as cleared on unmount: StrictMode mounts twice in dev, and a ref only cleared
  // would drop every progress event and the result after the second mount.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const local = isImportTarget(ollamaUrl);
  const candidate: KitCandidate | undefined = plan?.candidates[choice];
  const built = useMemo(() => (candidate ? specFor(candidate) : null), [candidate]);
  const bytes = candidate ? candidateBytes(candidate) : 0;
  const room = plan ? hasRoom(bytes, plan.freeBytes) : null;
  const tooOld = built?.ok ? needsNewerOllama(built.spec.requires, ollamaVersion) : false;
  const problem = nameProblem(name, installed);
  const alreadyHave = candidate?.kind === "ollama" && nameTaken(candidate.name, installed);
  const running = run.at === "running";

  const choose = (p: KitPlan, i: number, models: string[]) => {
    setChoice(i);
    const c = p.candidates[i];
    setName(c ? suggestedName(c) : "");
    if (c && nameTaken(suggestedName(c), models)) setName(`${suggestedName(c).replace(/:/g, "-")}-kit`);
  };

  const pick = async () => {
    setPickError(null);
    setPicking(true);
    try {
      const p = await pickModelFolder();
      if (!p) return;
      const [tags, version] = await Promise.all([getOllamaModels(ollamaUrl), getOllamaVersion(ollamaUrl)]);
      setInstalled(tags.models);
      setOllamaVersion(version);
      setPlan(p);
      setRun({ at: "idle" });
      choose(p, 0, tags.models);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  };

  const useExisting = async (model: string) => {
    await setChatModel(model);
    setRun({ at: "done", name: model, checked: true });
    onImported(model);
  };

  const start = async () => {
    if (!built?.ok || problem) return;
    const target = name.trim();
    setCancelling(false);
    setRun({ at: "running", phase: "checking", done: 0, total: bytes, file: "", started: Date.now(), skipped: 0, status: "", unchecked: 0 });
    let unchecked = 0;
    const onEvent = (e: ImportEvent) => {
      if (!mounted.current) return;
      setRun((r) => {
        if (r.at !== "running") return r;
        switch (e.kind) {
          case "phase": return { ...r, phase: e.phase, done: 0, total: e.total, started: Date.now() };
          case "bytes": return { ...r, phase: e.phase, done: e.done, total: e.total, file: e.file };
          case "skipped": return { ...r, skipped: r.skipped + e.bytes };
          case "unchecked": unchecked += 1; return { ...r, unchecked: r.unchecked + 1 };
          case "status": return { ...r, status: e.text };
        }
      });
    };
    try {
      const done = await startModelImport(target, built.spec, onEvent);
      // Switch the tutor only while this screen is still there to say so; a model that changes under
      // the learner with nothing on screen is worse than one they pick in Settings later.
      if (!mounted.current) return;
      await setChatModel(done);
      setRun({ at: "done", name: done, checked: built.checked && unchecked === 0 });
      setInstalled((m) => [...m, done]);
      onImported(done);
    } catch (e) {
      if (!mounted.current) return;
      setRun({ at: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const cancel = async () => {
    setCancelling(true);
    await cancelModelImport().catch(() => {});
  };

  if (!local) {
    return (
      <p className="text-sm text-[var(--ink-dim)]">
        Importing only talks to Ollama at its usual address, <code className="font-lcd">{IMPORT_TARGET}</code>. OpenEdu
        is set to use <code className="font-lcd">{ollamaUrl}</code>; change that in Settings first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!plan && (
        <div>
          <p className="text-sm text-[var(--ink-dim)] leading-relaxed">
            Plug in the USB stick (or open the folder) that has the model, then choose it. Nothing is downloaded, and
            the files on the stick aren't changed.
          </p>
          <button onClick={pick} disabled={picking} className="btn btn-primary text-sm mt-3">
            {picking ? "Looking…" : "Choose the folder…"}
          </button>
        </div>
      )}

      {pickError && <Note tone="danger">{pickError}</Note>}

      {plan && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-[var(--ink-dim)] min-w-0">
              From <code className="font-lcd text-ink break-all">{plan.root}</code>
            </p>
            {!running && (
              <button onClick={pick} disabled={picking} className="text-sm text-phosphor-ink hover:underline shrink-0">
                Choose another folder
              </button>
            )}
          </div>

          {plan.candidates.length === 0 && plan.problems.length > 0 && (
            <Note tone="danger">No model in this folder can be imported, because:</Note>
          )}
          {plan.candidates.length === 0 && plan.problems.length === 0 && (
            <Note tone="warning">
              No model in this folder. Choose the folder that holds <code className="font-lcd">manifests</code> and{" "}
              <code className="font-lcd">blobs</code>, or one with a <code className="font-lcd">Modelfile</code> and a{" "}
              <code className="font-lcd">.gguf</code> file. The kit's <code className="font-lcd">models</code> folder works too.
            </Note>
          )}
          {plan.problems.map((p, i) => <Note key={i} tone="warning">{p}</Note>)}

          {plan.candidates.length > 1 && (
            <div role="radiogroup" aria-label="Model to import" className="space-y-1.5">
              {plan.candidates.map((c, i) => (
                <label key={i} className={`kit-choice ${i === choice ? "kit-choice-on" : ""}`}>
                  <input type="radio" name="kit-model" checked={i === choice} disabled={running} onChange={() => choose(plan, i, installed)} className="sr-only" />
                  <span className="text-sm text-ink">{c.kind === "ollama" ? c.name : c.dir || "this folder"}</span>
                  <span className="text-sm text-[var(--ink-faint)] ml-auto">{formatBytes(candidateBytes(c))}</span>
                </label>
              ))}
            </div>
          )}

          {candidate && (
            <div className="kit-card kit-card-flat space-y-3">
              <dl className="kit-facts">
                <dt>Model</dt>
                <dd>{candidate.kind === "ollama" ? candidate.name : candidate.dir || "this folder"} <span className="text-[var(--ink-faint)]">· {candidate.kind === "ollama" ? "Ollama export" : "GGUF + Modelfile"}</span></dd>
                <dt>Size</dt>
                <dd>
                  {formatBytes(bytes)}
                  {plan.freeBytes !== null && <span className={room ? "text-[var(--ink-faint)]" : "text-danger"}> · {formatBytes(plan.freeBytes)} free on this computer</span>}
                </dd>
                <dt>Licence</dt>
                <dd className="space-y-1">
                  {licenceNotes(candidate, built).map((n, i) => (
                    <span key={i} className={`block ${n.tone === "warning" ? "text-warning" : ""}`}>{n.text}</span>
                  ))}
                </dd>
              </dl>

              {built && !built.ok && built.errors.map((e, i) => <Note key={i} tone="danger">{e}</Note>)}
              {built?.ok && run.at !== "done" && built.warnings.map((w, i) => <Note key={i} tone="warning">{w}</Note>)}
              {room === false && <Note tone="danger">There isn't enough free space for this model. Free up {formatBytes(bytes + 1024 ** 3 - (plan.freeBytes ?? 0))} and choose the folder again.</Note>}
              {tooOld && <Note tone="warning">This model needs Ollama {built?.ok && built.spec.requires} or newer, and this computer has {ollamaVersion}. Update Ollama first, or Ollama may refuse it.</Note>}

              {alreadyHave && run.at !== "done" && candidate.kind === "ollama" && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-[var(--ink-dim)]">This computer already has {candidate.name}.</p>
                  <button onClick={() => useExisting(installed.find((m) => nameTaken(candidate.name, [m])) ?? candidate.name)} disabled={running} className="btn text-sm">
                    Use it for tutoring
                  </button>
                </div>
              )}

              {built?.ok && run.at !== "done" && (
                <label className="block">
                  <span className="text-sm text-ink">Name in Ollama</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={running}
                    spellCheck={false}
                    className="mt-1.5 w-full px-3.5 py-2.5 rounded-[var(--radius-control)] bg-panel border border-[var(--rule-strong)] text-ink text-sm font-lcd focus:outline-none focus:border-phosphor disabled:opacity-60"
                  />
                  {problem && name.trim() && <span className="block text-sm text-danger mt-1.5">{problem}</span>}
                </label>
              )}
            </div>
          )}

          {run.at === "running" && <Progress run={run} checked={!!built?.ok && built.checked && run.unchecked === 0} cancelling={cancelling} onCancel={cancel} />}

          {run.at === "done" && (
            <Note tone="success">
              <strong>{run.name}</strong> is ready, and the tutor now uses it.
              {!run.checked && " Its files weren't checked for damage, because the kit has no checksum file."}
            </Note>
          )}
          {run.at === "failed" && <Note tone="danger">{run.message}</Note>}

          {candidate && built?.ok && run.at !== "running" && run.at !== "done" && (
            <button onClick={start} disabled={!!problem || room === false} className="btn btn-primary text-sm">
              {run.at === "failed" ? "Try again" : `Import ${formatBytes(bytes)}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Progress({ run, checked, cancelling, onCancel }: { run: Extract<Run, { at: "running" }>; checked: boolean; cancelling: boolean; onCancel: () => void }) {
  const fraction = importFraction(run.phase, run.done, run.total);
  const byteful = run.phase === "verifying" || run.phase === "copying";
  const eta = byteful ? formatEta(etaSeconds(run.done, run.total, Date.now() - run.started)) : "";
  const at = PHASES.indexOf(run.phase);
  return (
    <div className="kit-card kit-card-flat" aria-live="polite">
      <ol className="kit-track" aria-label="Import steps">
        {PHASES.map((p, i) => {
          // With nothing to check against, the files are only read: that step never shows a pass.
          const unverified = p === "verifying" && !checked;
          const cls = i < at ? (unverified ? "kit-track-skip" : "kit-track-done") : i === at ? "kit-track-now" : "";
          return (
            <li key={p} className={cls}>
              <span className="kit-track-dot" aria-hidden>{i < at ? (unverified ? "–" : "✓") : i + 1}</span>
              <span>{unverified ? "Not checked" : PHASE_SHORT[p]}</span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-ink mt-4">
        {cancelling ? "Stopping…" : run.phase === "verifying" && !checked ? "Reading the files (there's no checksum to check them against)" : PHASE_LABEL[run.phase]}
      </p>
      <div className="h-2 rounded-full bg-phosphor-dim overflow-hidden mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <div className="h-full bg-phosphor transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <div className="flex items-center gap-3 mt-2">
        <p className="text-sm text-[var(--ink-faint)] flex-1 min-w-0 truncate">
          {byteful && run.total > 0 ? `${formatBytes(run.done)} of ${formatBytes(run.total)}` : run.status || "Working…"}
          {run.file && byteful ? ` · ${run.file.length > 28 ? `${run.file.slice(0, 18)}…` : run.file}` : ""}
          {eta ? ` · ${eta}` : ""}
          {run.phase === "copying" && run.skipped > 0 ? ` · ${formatBytes(run.skipped)} was already there` : ""}
        </p>
        {run.phase !== "finishing" && (
          <button onClick={onCancel} disabled={cancelling} className="btn text-sm shrink-0">Cancel</button>
        )}
      </div>
    </div>
  );
}

function Note({ tone, children }: { tone: "danger" | "warning" | "success"; children: ReactNode }) {
  const cls = {
    danger: "text-danger bg-danger-tint border-danger/30",
    warning: "text-warning bg-warning-tint border-warning/30",
    success: "text-success bg-success-tint border-success/30",
  }[tone];
  return <p className={`text-sm border rounded-[var(--radius-control)] px-3 py-2 leading-relaxed ${cls}`}>{children}</p>;
}
