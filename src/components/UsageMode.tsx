import { useState } from "react";
import { USAGE_MODES, isProtected, submitTeacherPin, type UsageMode } from "../lib/usage-modes";
import type { PinRecord } from "../lib/learner-pin";
import { BIG_BTN, PinScreen } from "./LearnerPicker";
import { PinInput } from "./LearnerMenu";

// "Who uses this computer?" The first-run question, the tiles Settings reuses to change the answer,
// the form that sets a teacher PIN, and the overlay that asks for it. The rules live in
// usage-modes.ts; this file only draws them.

const ICONS: Record<UsageMode, string> = {
  single: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8",
  class: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6|M17 11a3 3 0 1 0 0-6|M21 20c0-3-2-5.5-4.5-6",
  school: "M3 21h18|M5 21V10l7-5 7 5v11|M10 21v-5h4v5|M9 12h.01|M15 12h.01",
};

export function ModeTiles({ value, onPick, compact }: {
  value: UsageMode | null;
  onPick: (mode: UsageMode) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-4 ${compact ? "sm:grid-cols-3" : "md:grid-cols-3 max-w-4xl w-full"}`}>
      {USAGE_MODES.map((m) => {
        const active = value === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            aria-pressed={active}
            className={`flex flex-col items-center text-center gap-3 rounded-xl border p-6 transition-colors ${
              active
                ? "border-[var(--phosphor)] bg-[rgb(var(--phosphor-rgb)/0.10)]"
                : "border-[var(--rule)] bg-panel hover:border-[var(--phosphor)] hover:bg-[rgb(var(--phosphor-rgb)/0.06)]"
            }`}
          >
            <svg width={compact ? 36 : 56} height={compact ? 36 : 56} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-phosphor" aria-hidden>
              {ICONS[m.id].split("|").map((d, i) => <path key={i} d={d} />)}
            </svg>
            <span className={`${compact ? "text-lg" : "text-2xl"} text-ink`} style={{ fontFamily: "var(--font-display)" }}>{m.title}</span>
            <span className={`${compact ? "text-sm" : "text-lg"} text-[var(--ink-dim)]`}>{m.sentence}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Two entries of a new teacher PIN. Hashes it (PBKDF2, same as learner PINs) and hands back the record. */
export function TeacherPinSetup({ onBack, onSet, large }: {
  onBack: () => void;
  onSet: (record: PinRecord) => void | Promise<void>;
  large?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(await submitTeacherPin(pin, again, onSet, setBusy));
  };

  const btn = large ? BIG_BTN : { fontSize: "1rem", padding: "10px 18px" };
  return (
    <form className="flex flex-col gap-4 w-[min(440px,92vw)]" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className={`${large ? "text-lg" : "text-base"} text-ink`}>
        Choose a teacher PIN. Learners will not know it. It opens Settings, the teacher view, and adding or removing learners.
      </p>
      <p className="text-base text-[var(--ink-dim)]">
        Write it down somewhere safe. If the teacher PIN is forgotten, it cannot be recovered yet.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-base text-ink">Teacher PIN (4 to 6 numbers)</span>
        <PinInput autoFocus value={pin} onChange={(v) => { setPin(v); setError(null); }} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-base text-ink">Teacher PIN again</span>
        <PinInput value={again} onChange={(v) => { setAgain(v); setError(null); }} />
      </label>
      {error && <p className="text-base text-red-400">{error}</p>}
      <div className="flex gap-3 justify-end">
        <button type="button" className="btn" style={btn} onClick={onBack}>Back</button>
        <button type="submit" className="btn btn-primary" style={btn} disabled={busy}>Save teacher PIN</button>
      </div>
    </form>
  );
}

/** First run: the full-screen question. "Just me" is one click; a class or school sets the teacher PIN. */
export function UsageModeChooser({ onChosen }: {
  onChosen: (mode: UsageMode, teacher: PinRecord | null) => Promise<void>;
}) {
  const [picked, setPicked] = useState<UsageMode | null>(null);

  if (picked && isProtected(picked)) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-6 p-8 bg-bg">
        <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>Teacher PIN</h1>
        <TeacherPinSetup large onBack={() => setPicked(null)} onSet={(rec) => onChosen(picked, rec)} />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-8 p-8 bg-bg">
      <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
        Who uses this computer?
      </h1>
      <ModeTiles value={picked} onPick={(m) => (isProtected(m) ? setPicked(m) : void onChosen(m, null))} />
      <p className="text-base text-[var(--ink-dim)]">You can change this later in Settings.</p>
    </div>
  );
}

/** The teacher PIN pad as an overlay over whatever is on screen. */
export function TeacherPinPrompt({ record, onCancel, onOk }: {
  record: { pin_hash: string | null; pin_salt: string | null };
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 top-8 z-[10001] flex flex-col bg-bg">
      <PinScreen name="Teacher" record={record} onBack={onCancel} onUnlocked={onOk} />
    </div>
  );
}
