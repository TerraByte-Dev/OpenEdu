// Who reads the learning record (#258, spec §1 rule 4). Pure. The learner's stored answer
// (learners.record_voice, migration 18) wins; otherwise the grade decides; with no grade, the record
// asks once ("Who reads this record?") and stores the answer.

import { normalizeGrade } from "../grade";

export type RecordVoice = "self" | "guided" | "ask";

export function recordVoice({ stored, grade }: { stored: string | null; grade: number | null }): RecordVoice {
  if (stored === "self" || stored === "guided") return stored;
  const g = normalizeGrade(grade);
  if (g === null) return "ask";
  return g <= 8 ? "guided" : "self";
}
