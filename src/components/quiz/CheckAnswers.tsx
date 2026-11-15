import { useState } from "react";

// Marking written answers no model checked: each one with its question, the answer given and the answer
// key, and Right / Not yet. Saving waits until every answer has a mark. The words come from the caller
// (level-test.ts SELF_CHECK), so the same list serves whoever does the marking.

export interface AnswerToCheck {
  id: string;
  question_text: string;
  user_answer: string | null;
  correct_answer: string;
}

export interface CheckAnswersCopy {
  yourAnswer: string;
  key: string;
  right: string;
  notYet: string;
  save: string;
  saving: string;
  saveFailed: string;
}

export default function CheckAnswers({ answers, copy, onSave }: {
  answers: ReadonlyArray<AnswerToCheck>;
  copy: CheckAnswersCopy;
  /** Throws when the marks could not be saved; they stay on screen to try again. */
  onSave: (marks: ReadonlyMap<string, boolean>) => Promise<void>;
}) {
  const [marks, setMarks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const allMarked = answers.every((a) => marks.has(a.id));

  const mark = (id: string, right: boolean) => setMarks((m) => new Map(m).set(id, right));
  const save = async () => {
    setSaving(true);
    setFailed(false);
    try { await onSave(marks); }
    catch (e) { console.error("saving marks failed", e); setFailed(true); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {answers.map((a, i) => {
        const m = marks.get(a.id);
        return (
          <div key={a.id} className="p-4 rounded-xl border border-[var(--rule)] bg-panel text-base">
            <p className="text-ink font-medium">{i + 1}. {a.question_text}</p>
            <p className="mt-2 text-[var(--ink-dim)]">{copy.yourAnswer}: <span className="text-ink">{a.user_answer ?? ""}</span></p>
            <p className="mt-1 text-[var(--ink-dim)]">{copy.key}: <span className="text-ink">{a.correct_answer}</span></p>
            <div className="flex gap-2 mt-3" role="radiogroup" aria-label={`${i + 1}. ${a.question_text}`}>
              <button role="radio" aria-checked={m === true} className={m === true ? "btn btn-primary" : "btn"} onClick={() => mark(a.id, true)}>{copy.right}</button>
              <button role="radio" aria-checked={m === false} className={m === false ? "btn btn-primary" : "btn"} onClick={() => mark(a.id, false)}>{copy.notYet}</button>
            </div>
          </div>
        );
      })}
      {failed && <p className="text-danger text-sm">{copy.saveFailed}</p>}
      <button className="btn btn-primary w-full" disabled={!allMarked || saving} onClick={() => void save()}>
        {saving ? copy.saving : copy.save}
      </button>
    </div>
  );
}
