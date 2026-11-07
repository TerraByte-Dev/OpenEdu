import { useState } from "react";
import type { SectionProps } from "../types";
import { Section, useSettings } from "../primitives";
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
        {error && <p className="text-sm text-red-400">{error}</p>}
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
