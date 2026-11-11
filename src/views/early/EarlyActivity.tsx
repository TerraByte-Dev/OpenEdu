import { useEffect, useMemo, useState } from "react";
import { SKILLS, choiceKey, choiceLabel, packOf } from "../../lib/early/packs";
import { buildRound, choiceOrder, tap, type Feedback, type NewAttempt } from "../../lib/early/engine";
import type { Choice, Picture, SkillId } from "../../lib/early/types";
import type { ReadAloud } from "../../lib/useReadAloud";
import { BackIcon, ChoiceFace, NextIcon, PersonIcon, PictureView, SpeakerIcon, Star } from "./pictures";

// One round of a K-1 activity (#244): ROUND_SIZE items, each spoken as it appears. A right tap is
// praised; a wrong tap teaches (count together, or show the example) and the child tries again, never
// "wrong" in red. Every tap is stored through `onAttempt`; the round's order comes from `seed`.

interface Props {
  skillId: SkillId;
  /** The last item the learner saw in this skill: the round does not open on it. */
  avoid: string | null;
  seed: number;
  /** Mastered before this round started: the end screen celebrates a skill mastered during it. */
  masteredBefore: boolean;
  /** Mastered now, from the stored attempts. */
  masteredNow: boolean;
  speech: ReadAloud;
  onAttempt: (a: NewAttempt) => void;
  onPlayAgain: () => void;
  onHome: () => void;
}

export default function EarlyActivity({ skillId, avoid, seed, masteredBefore, masteredNow, speech, onAttempt, onPlayAgain, onHome }: Props) {
  const skill = SKILLS[skillId];
  const round = useMemo(() => buildRound(skill, avoid, seed), [skill, avoid, seed]);
  const [index, setIndex] = useState(0);
  const [firstTry, setFirstTry] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [rightFirstTime, setRightFirstTime] = useState(0);
  const done = index >= round.length;
  const item = done ? null : round[index];
  const choices = useMemo(() => (item ? choiceOrder(item, seed + index) : []), [item, seed, index]);
  const { speak } = speech;

  // Say the prompt when an item appears. Leaving the screen stops the voice (useReadAloud's unmount).
  useEffect(() => {
    if (item) speak(`prompt:${index}`, item.prompt);
  }, [item, index, speak]);

  const onTap = (choice: Choice) => {
    if (!item || feedback?.kind === "praise") return;
    const r = tap(item, choice, firstTry);
    onAttempt(r.attempt);
    setPicked(choiceKey(choice));
    setFeedback(r.feedback);
    if (r.feedback.kind === "praise") {
      if (firstTry) setRightFirstTime((n) => n + 1);
      speak(`praise:${index}`, r.feedback.say);
    } else {
      setFirstTry(false);
      speak(`teach:${index}`, r.feedback.say);
    }
  };

  const tryAgain = () => {
    setPicked(null);
    setFeedback(null);
    if (item) speak(`prompt:${index}:again`, item.prompt);
  };

  const next = () => {
    setIndex((i) => i + 1);
    setFirstTry(true);
    setPicked(null);
    setFeedback(null);
  };

  // The end of the round.
  useEffect(() => {
    if (!done) return;
    const learned = masteredNow && !masteredBefore;
    speak("end", learned ? `You learned ${skill.name}!` : "Great job! You finished.");
  }, [done, masteredNow, masteredBefore, skill.name, speak]);

  const teaching = feedback?.kind === "teach" ? feedback : null;
  const pictures: Picture[] = [];
  if (item && item.picture.kind !== "none") pictures.push(item.picture);
  if (teaching?.example) pictures.push(teaching.example);
  const numbered = !!teaching?.countAlong;

  return (
    <div className="early flex-1 min-h-0 overflow-y-auto flex flex-col">
      <header className="flex flex-wrap items-center gap-4 px-10 py-4">
        <button type="button" className="early-round early-back w-16 h-16" aria-label="Back to my activities" onClick={onHome}>
          <BackIcon />
        </button>
        <div role="img" aria-label={done ? "All done" : `Question ${index + 1} of ${round.length}`} className="flex gap-2.5 grow justify-center">
          {round.map((_, i) => (
            <span
              key={i}
              className="w-[18px] h-[18px] rounded-full box-border"
              style={
                i < index || done ? { background: "var(--phosphor)" }
                  : i === index ? { background: "var(--panel)", border: "3px solid var(--phosphor)" }
                  : { background: "var(--rule)" }
              }
            />
          ))}
        </div>
        <span className="w-16" />
      </header>

      {item ? (
        <main className="w-full max-w-[1040px] mx-auto px-10 pt-2 pb-8 flex flex-col items-center gap-6">
          <div className="flex items-center gap-[18px]">
            {speech.supported && (
              <button
                type="button"
                className="early-round early-speak w-[72px] h-[72px]"
                aria-label="Hear the question again"
                aria-pressed={speech.speakingId?.startsWith(`prompt:${index}`) ?? false}
                onClick={() => speak(`prompt:${index}:again`, item.prompt)}
              >
                <SpeakerIcon size={34} />
              </button>
            )}
            <h1 className="m-0 text-[44px] font-semibold tracking-[-0.01em] text-ink">{item.prompt}</h1>
          </div>

          {pictures.length > 0 && (
            <div className="box-border w-full px-6 pt-7 pb-5 rounded-[28px] bg-panel border border-[var(--rule)] flex flex-wrap items-center justify-center gap-10">
              {pictures.map((p, i) => <PictureView key={i} picture={p} numbered={numbered} />)}
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-6">
            {choices.map((c) => {
              const key = choiceKey(c);
              const state = picked === key
                ? (feedback?.kind === "praise" ? "right" : "tried")
                : feedback?.kind === "praise" ? "rest" : "idle";
              return (
                <button
                  key={key}
                  type="button"
                  className="early-choice"
                  data-state={state}
                  data-key={key}
                  disabled={feedback?.kind === "praise"}
                  aria-label={choiceLabel(c) + (state === "right" ? ", yes" : state === "tried" ? ", try again" : "")}
                  onClick={() => onTap(c)}
                >
                  <ChoiceFace choice={c} />
                </button>
              );
            })}
          </div>

          {feedback?.kind === "praise" && (
            <div className="flex flex-wrap items-center justify-center gap-4">
              <div role="status" className="early-feedback" data-kind="praise">
                <Star filled size={34} />
                {feedback.say}
              </div>
              <button type="button" className="early-btn" onClick={next} aria-label="Next">
                Next <NextIcon />
              </button>
            </div>
          )}
          {teaching && (
            <div role="status" className="early-feedback" data-kind="teach">
              {teaching.say}
              <button type="button" className="early-btn" onClick={tryAgain}>Try again</button>
            </div>
          )}
        </main>
      ) : (
        <RoundEnd
          stars={rightFirstTime}
          total={round.length}
          learned={masteredNow && !masteredBefore ? skill : null}
          nextSkill={masteredNow && !masteredBefore ? nextInPack(skillId) : null}
          onPlayAgain={onPlayAgain}
          onHome={onHome}
        />
      )}

      <footer className="early-footer">
        <PersonIcon />
        <span><b className="font-semibold text-ink">Grown-up tip:</b> {skill.grownUpTip}</span>
      </footer>
    </div>
  );
}

function nextInPack(id: SkillId): SkillId | null {
  const skills = packOf(SKILLS[id].pack).skills;
  return skills[skills.indexOf(id) + 1] ?? null;
}

function RoundEnd({ stars, total, learned, nextSkill, onPlayAgain, onHome }: {
  stars: number;
  total: number;
  learned: (typeof SKILLS)[SkillId] | null;
  nextSkill: SkillId | null;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  return (
    <main className="w-full max-w-[1040px] mx-auto px-10 pt-6 pb-8 flex flex-col items-center gap-7 text-center">
      <h1 className="m-0 text-[48px] font-semibold text-ink">{learned ? `You learned ${learned.name}!` : "Great job!"}</h1>
      <div role="img" aria-label={`${stars} of ${total} right the first time`} className="flex gap-2">
        {Array.from({ length: total }, (_, i) => <Star key={i} filled={i < stars} size={56} />)}
      </div>
      {nextSkill && <p className="m-0 text-[26px] text-[var(--ink-dim)]">Next: {SKILLS[nextSkill].name}.</p>}
      <div className="flex flex-wrap justify-center gap-4">
        <button type="button" className="early-btn" onClick={onPlayAgain}>Play again</button>
        <button type="button" className="early-btn early-btn-quiet" onClick={onHome}>Home</button>
      </div>
    </main>
  );
}
