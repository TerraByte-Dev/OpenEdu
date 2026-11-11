import { useState } from "react";
import { createLearner, renameLearner, setLearnerPin, deleteLearner } from "../lib/db";
import { clearLearnerStore } from "../lib/store";
import {
  canDeleteLearner, validateLearnerName, deleteConfirmMatches,
  LEARNER_NAME_MAX, type LearnerRow,
} from "../lib/learners";
import { hashPin, verifyPin, isValidPin } from "../lib/learner-pin";
import { Initial, BIG_BTN } from "./LearnerPicker";
import { showsPicker, learnersManageLearners, type UsageMode } from "../lib/usage-modes";
import type { Grade } from "../lib/grade";
import { GradeSelect } from "./GradeSelect";

// The active learner's own controls, opened from the titlebar. Everything here acts on the learner
// who is signed in and nobody else: you can rename, set a PIN for, or delete only yourself. In a class
// or school (usage-modes.ts) adding and deleting learners moves to the teacher view.

interface LearnerMenuProps {
  learner: LearnerRow;
  learners: LearnerRow[];
  mode: UsageMode;
  /** Set while a course is being built: switching would hand the build's screen to someone else. */
  busyReason: string | null;
  onClose: () => void;
  onSwitch: () => void;
  /** A learner was added; enter them. */
  onAdded: (learner: LearnerRow) => void;
  /** Name or PIN changed; reload the learner list. */
  onChanged: () => void;
  /** This learner and their courses are gone. */
  onDeleted: () => void;
}

type Panel = null | "add" | "rename" | "pin" | "delete";

const SMALL_BTN: React.CSSProperties = { fontSize: "1rem", padding: "10px 18px" };
const INPUT: React.CSSProperties = { fontSize: "1.15rem" };

export default function LearnerMenu({ learner, learners, mode, busyReason, onClose, onSwitch, onAdded, onChanged, onDeleted }: LearnerMenuProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const canSwitch = showsPicker(mode, learners);
  const selfService = learnersManageLearners(mode);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Learner"
        className="bg-panel border border-[var(--rule)] rounded-xl p-6 w-[min(480px,94vw)] max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4">
          <Initial name={learner.name} />
          <div className="flex-1 min-w-0">
            <div className="text-base text-[var(--ink-dim)]">Learning now</div>
            <div className="text-2xl text-ink truncate" style={{ fontFamily: "var(--font-display)" }}>{learner.name}</div>
          </div>
          <button className="btn" style={SMALL_BTN} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {busyReason && <p className="text-base text-warning">{busyReason}</p>}

        {panel === null && (
          <div className="flex flex-col gap-3">
            {canSwitch && (
              <button className="btn btn-primary justify-center" style={BIG_BTN} disabled={!!busyReason} onClick={onSwitch}>
                Switch learner
              </button>
            )}
            {selfService && (
              <button className="btn justify-center" style={BIG_BTN} disabled={!!busyReason} onClick={() => setPanel("add")}>Add learner</button>
            )}
            <button className="btn justify-center" style={BIG_BTN} onClick={() => setPanel("rename")}>Change my name</button>
            <button className="btn justify-center" style={BIG_BTN} onClick={() => setPanel("pin")}>
              {learner.pin_hash ? "Change or remove my PIN" : "Set a PIN"}
            </button>
            {selfService ? (
              <button className="btn justify-center" style={BIG_BTN} disabled={!!busyReason} onClick={() => setPanel("delete")}>Delete me</button>
            ) : (
              <p className="text-base text-[var(--ink-dim)]">Your teacher adds and removes learners, and can clear a PIN you forget.</p>
            )}
          </div>
        )}

        {panel === "add" && <AddPanel learners={learners} onBack={() => setPanel(null)} onAdded={onAdded} />}
        {panel === "rename" && (
          <RenamePanel learner={learner} learners={learners} onBack={() => setPanel(null)} onDone={() => { onChanged(); setPanel(null); }} />
        )}
        {panel === "pin" && <PinPanel learner={learner} teacherCanReset={!selfService} onBack={() => setPanel(null)} onDone={() => { onChanged(); setPanel(null); }} />}
        {panel === "delete" && (
          <DeletePanel learner={learner} learners={learners} onBack={() => setPanel(null)} onDeleted={onDeleted} />
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-base text-ink">{label}</span>
      {children}
    </label>
  );
}

function Actions({ onBack, submitLabel, busy, danger }: { onBack: () => void; submitLabel: string; busy: boolean; danger?: boolean }) {
  return (
    <div className="flex gap-3 justify-end">
      <button type="button" className="btn" style={SMALL_BTN} onClick={onBack}>Back</button>
      <button
        type="submit"
        className={danger ? "btn" : "btn btn-primary"}
        style={danger ? { ...SMALL_BTN, borderColor: "var(--danger)", color: "var(--danger)" } : SMALL_BTN}
        disabled={busy}
      >
        {submitLabel}
      </button>
    </div>
  );
}

function ErrorLine({ msg }: { msg: string | null }) {
  return msg ? <p className="text-base text-danger">{msg}</p> : null;
}

function AddPanel({ learners, onBack, onAdded }: { learners: LearnerRow[]; onBack: () => void; onAdded: (l: LearnerRow) => void }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const err = validateLearnerName(name, learners);
    if (err) { setError(err); return; }
    setBusy(true);
    try { onAdded(await createLearner(name, null, grade)); }
    catch { setError("Could not add that learner. Try again."); setBusy(false); }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-base text-[var(--ink-dim)]">The new learner starts with no courses. The app switches to them.</p>
      <Field label="Name">
        <input autoFocus className="cf-input" style={INPUT} maxLength={LEARNER_NAME_MAX} value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }} />
      </Field>
      <Field label="Grade">
        <GradeSelect value={grade} onChange={setGrade} style={INPUT} />
      </Field>
      <ErrorLine msg={error} />
      <Actions onBack={onBack} submitLabel="Add and switch" busy={busy} />
    </form>
  );
}

function RenamePanel({ learner, learners, onBack, onDone }: { learner: LearnerRow; learners: LearnerRow[]; onBack: () => void; onDone: () => void }) {
  const [name, setName] = useState(learner.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const err = validateLearnerName(name, learners, learner.id);
    if (err) { setError(err); return; }
    setBusy(true);
    try { await renameLearner(learner.id, name); onDone(); }
    catch { setError("Could not save the name. Try again."); setBusy(false); }
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="Name">
        <input autoFocus className="cf-input" style={INPUT} maxLength={LEARNER_NAME_MAX} value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }} />
      </Field>
      <ErrorLine msg={error} />
      <Actions onBack={onBack} submitLabel="Save" busy={busy} />
    </form>
  );
}

export function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      maxLength={6}
      className="cf-input"
      style={{ ...INPUT, letterSpacing: "0.4em" }}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
    />
  );
}

function PinPanel({ learner, teacherCanReset, onBack, onDone }: { learner: LearnerRow; teacherCanReset: boolean; onBack: () => void; onDone: () => void }) {
  const hasPin = !!learner.pin_hash;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Changing or removing an existing PIN asks for it first, so someone who walks up to a session
  // left open cannot lock its owner out.
  const checkCurrent = async (): Promise<boolean> => {
    if (!hasPin) return true;
    if (await verifyPin(current, learner)) return true;
    setError("Your current PIN is not right.");
    setCurrent("");
    return false;
  };

  const save = async () => {
    if (!isValidPin(next)) { setError("A PIN is 4 to 6 numbers."); return; }
    if (next !== confirm) { setError("The two new PINs are different."); return; }
    setBusy(true);
    try {
      if (!(await checkCurrent())) return;
      const rec = await hashPin(next);
      await setLearnerPin(learner.id, rec.pin_hash, rec.pin_salt);
      onDone();
    } catch {
      setError("Could not save the PIN. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (!(await checkCurrent())) return;
      await setLearnerPin(learner.id, null, null);
      onDone();
    } catch {
      setError("Could not remove the PIN. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-base text-[var(--ink-dim)]">
        A PIN keeps other learners on this computer out of your courses.{" "}
        {teacherCanReset ? "If you forget it, your teacher can clear it." : "If you forget it, it cannot be recovered yet."}
      </p>
      {hasPin && (
        <Field label="Current PIN">
          <PinInput autoFocus value={current} onChange={(v) => { setCurrent(v); setError(null); }} />
        </Field>
      )}
      <Field label="New PIN (4 to 6 numbers)">
        <PinInput autoFocus={!hasPin} value={next} onChange={(v) => { setNext(v); setError(null); }} />
      </Field>
      <Field label="New PIN again">
        <PinInput value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} />
      </Field>
      <ErrorLine msg={error} />
      {hasPin && (
        <button type="button" className="btn justify-center" style={SMALL_BTN} disabled={busy} onClick={() => void remove()}>
          Remove my PIN
        </button>
      )}
      <Actions onBack={onBack} submitLabel={hasPin ? "Change PIN" : "Set PIN"} busy={busy} />
    </form>
  );
}

function DeletePanel({ learner, learners, onBack, onDeleted }: { learner: LearnerRow; learners: LearnerRow[]; onBack: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canDeleteLearner(learners)) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base text-ink">You are the only learner on this computer, so you cannot be deleted. Add another learner first.</p>
        <div className="flex justify-end"><button className="btn" style={SMALL_BTN} onClick={onBack}>Back</button></div>
      </div>
    );
  }

  const submit = async () => {
    if (!deleteConfirmMatches(typed, learner.name)) { setError(`Type ${learner.name} to confirm.`); return; }
    setBusy(true);
    try {
      if (learner.pin_hash && !(await verifyPin(pin, learner))) {
        setError("Your PIN is not right.");
        setPin("");
        setBusy(false);
        return;
      }
      await deleteLearner(learner.id);
      await clearLearnerStore(learner.id).catch(() => { /* a leftover tour flag is harmless */ });
      onDeleted();
    } catch {
      setError("Could not delete everything. Try again.");
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-base text-ink">
        This deletes <strong>{learner.name}</strong> and all of their courses, chats, notes, quizzes and flashcards. It cannot be undone.
      </p>
      <Field label={`Type ${learner.name} to confirm`}>
        <input autoFocus className="cf-input" style={INPUT} value={typed} onChange={(e) => { setTyped(e.target.value); setError(null); }} />
      </Field>
      {learner.pin_hash && (
        <Field label="Your PIN">
          <PinInput value={pin} onChange={(v) => { setPin(v); setError(null); }} />
        </Field>
      )}
      <ErrorLine msg={error} />
      <Actions onBack={onBack} submitLabel={busy ? "Deleting…" : "Delete forever"} busy={busy} danger />
    </form>
  );
}
