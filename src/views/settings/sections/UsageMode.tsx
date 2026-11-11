import { useEffect, useState } from "react";
import type { SectionProps } from "../types";
import { Section, SettingRow, Toggle, useSettings } from "../primitives";
import { GradeSelect } from "../../../components/GradeSelect";
import { isEarlyReader, autoReadAloud, hasEarlyScreens, earlyScreensOn, type Grade } from "../../../lib/grade";
import { getReadAloudAuto, setReadAloudAuto } from "../../../lib/store";
import { ModeTiles, TeacherPinSetup, TeacherPinPrompt } from "../../../components/UsageMode";
import { USAGE_MODES, modeChangeStep, isProtected, type UsageMode } from "../../../lib/usage-modes";

// "Who uses this computer?" in Settings. Changing the answer follows usage-modes.ts modeChangeStep:
// moving up from "Just me" sets a teacher PIN; leaving a class or school asks for it again (only the
// teacher can lower protection). While another learner has a PIN, moving up asks for the teacher PIN
// kept from before, or is refused when there is none. No change deletes anybody's data or the PIN.
export default function UsageModeSection({ usage }: SectionProps) {
  const { markSaved } = useSettings();
  const [pending, setPending] = useState<{ to: UsageMode; step: "set-teacher-pin" | "verify-teacher-pin" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!usage) return null;
  const { mode } = usage;
  const current = USAGE_MODES.find((m) => m.id === mode)!;

  // Throws on failure: the PIN form shows its own message and frees its button (submitTeacherPin).
  const apply = async (to: UsageMode, teacher: Parameters<typeof usage.changeMode>[1]) => {
    await usage.changeMode(to, teacher);
    setPending(null);
    setError(null);
    markSaved();
  };

  const pick = (to: UsageMode) => {
    const change = modeChangeStep(mode, to, usage.learners, usage.activeLearnerId, !!usage.teacher.pin_hash);
    if (change.step === "none") return;
    if (change.step === "refused") { setPending(null); setError(change.reason); return; }
    setError(null);
    setPending({ to, step: change.step });
  };

  const target = pending ? USAGE_MODES.find((m) => m.id === pending.to)! : null;

  return (
    <>
      <Section
        title="Who uses this computer?"
        description={`Now: ${current.title}. ${current.sentence}`}
        keywords="mode just me single class school center learners students teacher pin"
      >
        <ModeTiles compact value={mode} onPick={pick} />
        {pending?.step === "set-teacher-pin" && target && (
          <div className="rounded-xl border border-[var(--rule)] bg-panel-lite/60 p-5">
            <p className="text-base text-ink mb-3">Switching to <strong>{target.title}</strong>.</p>
            <TeacherPinSetup onBack={() => setPending(null)} onSet={(rec) => apply(pending.to, rec)} />
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-[var(--ink-faint)] leading-relaxed max-w-prose">
          Changing this never deletes anyone's courses or work. Going back to Just me needs the teacher PIN. The PIN is kept, so the teacher can switch back with it later.
        </p>
      </Section>

      <Section
        title={isProtected(mode) ? "Teacher" : "Learners"}
        keywords="teacher overview learners add remove pin reset class groups export csv rename"
      >
        <div className="flex gap-3 flex-wrap">
          {isProtected(mode) ? (
            <button className="btn btn-primary" onClick={() => usage.guard("settings-teacher-view", usage.openTeacher)}>Open the teacher view</button>
          ) : (
            <button className="btn" onClick={usage.openLearnerMenu}>Learner name, PIN and more learners</button>
          )}
        </div>
      </Section>

      {usage.activeLearnerId && <GradeSection usage={usage} learnerId={usage.activeLearnerId} />}

      {pending?.step === "verify-teacher-pin" && (
        <TeacherPinPrompt
          record={usage.teacher}
          onCancel={() => setPending(null)}
          onOk={() => {
            apply(pending.to, undefined)
              .catch(() => { setPending(null); setError("Could not change it. Try again."); });
          }}
        />
      )}
    </>
  );
}

// The signed-in learner's grade (#243): how the tutor writes for them, and for K-2 larger chat text
// and replies that read themselves aloud (a choice, on by default).
function GradeSection({ usage, learnerId }: { usage: NonNullable<SectionProps["usage"]>; learnerId: string }) {
  const { markSaved } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const grade = usage.activeGrade;

  useEffect(() => {
    let alive = true;
    getReadAloudAuto(learnerId).then((v) => { if (alive) setAutoChoice(v); }).catch(() => {});
    return () => { alive = false; };
  }, [learnerId]);

  const pickGrade = async (next: Grade | null) => {
    try { await usage.setActiveGrade(next); setError(null); markSaved(); }
    catch { setError("Could not save the grade. Try again."); }
  };

  const setAuto = async (on: boolean) => {
    setAutoChoice(on);
    try { await setReadAloudAuto(learnerId, on); markSaved(); }
    catch { setError("Could not save that. Try again."); }
  };

  const setEarly = async (on: boolean) => {
    try { await usage.setEarlyScreens(on); setError(null); markSaved(); }
    catch { setError("Could not save that. Try again."); }
  };

  return (
    <Section
      title="Grade"
      description="The tutor writes for this grade: shorter sentences and simpler words for younger learners. Kindergarten to grade 2 also get bigger chat text."
      keywords="grade school year reading level kindergarten text size read aloud speech voice speak early learner screens activities colors counting shapes"
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
      {hasEarlyScreens(grade) && (
        <SettingRow
          label="Early learner screens"
          help="Big picture activities for colors, counting and shapes, read aloud, with no typing and no AI. Turn off to open on the regular Home."
        >
          <Toggle
            checked={earlyScreensOn(grade, usage.earlyScreens)}
            onChange={(on) => void setEarly(on)}
            labelOn="On: opens on the early learner activities"
            labelOff="Off: opens on the regular Home"
          />
        </SettingRow>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  );
}
