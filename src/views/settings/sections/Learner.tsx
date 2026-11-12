import { useEffect, useState } from "react";
import type { SectionProps } from "../types";
import { INPUT_CLS, Section, SettingRow, Toggle, useSettings } from "../primitives";
import { GradeSelect } from "../../../components/GradeSelect";
import { isEarlyReader, autoReadAloud, type Grade } from "../../../lib/grade";
import { validateLearnerName, LEARNER_NAME_MAX } from "../../../lib/learners";
import { getReadAloudAuto, setReadAloudAuto } from "../../../lib/store";

// The signed-in learner: their name, and their grade (#243), which sets how the tutor writes for them
// and, for K-2, larger chat text and replies that read themselves aloud (a choice, on by default).
// There is no PIN here: OpenEdu is for one learner, and a PIN that cannot be reset would only lock
// them out. An earlier version's PIN is changed or removed in the learner menu.
export default function LearnerSection({ learner }: SectionProps) {
  const { markSaved } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const [name, setName] = useState(learner?.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const learnerId = learner?.id;
  const savedName = learner?.name;

  useEffect(() => {
    if (!learnerId) return;
    let alive = true;
    getReadAloudAuto(learnerId).then((v) => { if (alive) setAutoChoice(v); }).catch(() => {});
    return () => { alive = false; };
  }, [learnerId]);

  useEffect(() => { if (savedName !== undefined) setName(savedName); }, [savedName]);

  if (!learner) return null;
  const grade = learner.grade;

  // Commits on blur and Enter, like the other free-text settings.
  const commitName = async () => {
    if (name.trim() === learner.name.trim()) { setNameError(null); return; }
    const err = validateLearnerName(name, learner.learners, learner.id);
    if (err) { setNameError(err); return; }
    try { await learner.rename(name); setNameError(null); markSaved(); }
    catch { setNameError("Could not save the name. Try again."); }
  };

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
    <>
      <Section title="Name" keywords="name learner rename call me">
        <SettingRow label="Your name" help="The tutor and Home greet you by this name.">
          <div className="space-y-1.5">
            <input
              type="text"
              aria-label="Your name"
              value={name}
              maxLength={LEARNER_NAME_MAX}
              onChange={(e) => { setName(e.target.value); setNameError(null); }}
              onBlur={() => void commitName()}
              onKeyDown={(e) => { if (e.key === "Enter") void commitName(); }}
              className={INPUT_CLS}
            />
            {nameError && <p className="text-sm text-danger">{nameError}</p>}
          </div>
        </SettingRow>
      </Section>

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
    </>
  );
}
