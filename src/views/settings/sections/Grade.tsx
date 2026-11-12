import { useEffect, useState } from "react";
import type { SectionProps } from "../types";
import { Section, SettingRow, Toggle, useSettings } from "../primitives";
import { GradeSelect } from "../../../components/GradeSelect";
import { isEarlyReader, autoReadAloud, type Grade } from "../../../lib/grade";
import { getReadAloudAuto, setReadAloudAuto } from "../../../lib/store";

// The signed-in learner's grade (#243): how the tutor writes for them, and for K-2 larger chat text
// and replies that read themselves aloud (a choice, on by default).
export default function GradeSection({ learner }: SectionProps) {
  const { markSaved } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const learnerId = learner?.id;

  useEffect(() => {
    if (!learnerId) return;
    let alive = true;
    getReadAloudAuto(learnerId).then((v) => { if (alive) setAutoChoice(v); }).catch(() => {});
    return () => { alive = false; };
  }, [learnerId]);

  if (!learner) return null;
  const grade = learner.grade;

  const pickGrade = async (next: Grade | null) => {
    try { await learner.setGrade(next); setError(null); markSaved(); }
    catch { setError("Could not save the grade. Try again."); }
  };

  const setAuto = async (on: boolean) => {
    setAutoChoice(on);
    try { await setReadAloudAuto(learner.id, on); markSaved(); }
    catch { setError("Could not save that. Try again."); }
  };

  return (
    <Section
      title="Grade"
      description="The tutor writes for this grade: shorter sentences and simpler words for younger learners. Kindergarten to grade 2 also get bigger chat text."
      keywords="grade school year reading level kindergarten text size read aloud speech voice speak"
    >
      <SettingRow label="Your grade" help="Leave it not set and the tutor writes as it always has.">
        <GradeSelect value={grade} onChange={(g) => void pickGrade(g)} ariaLabel="Your grade" />
      </SettingRow>
      {isEarlyReader(grade) && (
        <SettingRow
          label="Read replies aloud"
          help="Each new tutor reply is read out with this computer's own voices. The speaker button next to a reply reads it again or stops it."
        >
          <Toggle
            checked={autoReadAloud(grade, autoChoice)}
            onChange={(on) => void setAuto(on)}
            labelOn="On: new replies read themselves"
            labelOff="Off: press the speaker button to hear a reply"
          />
        </SettingRow>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  );
}
