import { useState } from "react";

// "I think I was right" under a written answer the model marked wrong (written-answer-checks.ts). The
// button opens the answer key comparison and Right / Not yet. The words come from the caller
// (level-test.ts MARK_AGAIN), so the same control serves whoever marks it.

export interface MarkAgainCopy {
  ask: string;
  intro: string;
  right: string;
  notYet: string;
  saving: string;
  saveFailed: string;
}

export default function MarkAgain({ copy, onMark }: {
  copy: MarkAgainCopy;
  /** Throws when the mark could not be saved; the choice stays open to try again. */
  onMark: (right: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const mark = async (right: boolean) => {
    setSaving(true);
    setFailed(false);
    try { await onMark(right); }
    catch (e) { console.error("saving the mark failed", e); setFailed(true); }
    finally { setSaving(false); }
  };

  if (!open) {
    return <button className="btn mt-2 text-sm" onClick={() => setOpen(true)}>{copy.ask}</button>;
  }
  return (
    <div className="mt-2 text-sm">
      <p className="text-[var(--ink-dim)]">{copy.intro}</p>
      <div className="flex gap-2 mt-2">
        <button className="btn btn-primary" disabled={saving} onClick={() => void mark(true)}>{saving ? copy.saving : copy.right}</button>
        <button className="btn" disabled={saving} onClick={() => void mark(false)}>{copy.notYet}</button>
      </div>
      {failed && <p className="text-danger mt-1">{copy.saveFailed}</p>}
    </div>
  );
}
