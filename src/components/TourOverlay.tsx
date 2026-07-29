// The feature tour (#92) — what this app is for, once it can actually answer a question.
//
// Deliberately NOT absolutely-positioned coach marks pinned to elements. Those break the moment a
// layout changes, and this UI has changed three times this week; a tour that silently points at empty
// space is worse than no tour. This is a corner card that names each surface, so it stays correct as
// long as the names do.
//
// Shown once, skippable at every step, and never shown before setup is ready — a tour of an app that
// cannot answer is a tour of a disappointment.

export interface TourStep {
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Courses live on the left",
    body: "Make one for any topic. OpenEdu writes a six-level curriculum for it — that takes a few minutes, and only happens once.",
  },
  {
    title: "Chat is the main event",
    body: "Ask anything. The tutor knows which level you're on and what you've covered, so you don't have to re-explain yourself each time.",
  },
  {
    title: "Your notes get searched automatically",
    body: "Anything you write in Notes is searched before the tutor answers. When an answer uses one, it says which note it came from — and when it doesn't, it says that too.",
  },
  {
    title: "The chips under each reply",
    body: "They're suggestions for what to ask next. Some change how the tutor responds — 'Make me figure it out' stops it giving direct answers.",
  },
  {
    title: "Quizzes decide when you level up",
    body: "Quiz yourself whenever. When you're ready, the promotion test moves you to the next level. Nothing else advances you.",
  },
];

export interface TourOverlayProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
}

export default function TourOverlay({ step, onNext, onSkip }: TourOverlayProps) {
  const current = TOUR_STEPS[step];
  if (!current) return null;
  const last = step === TOUR_STEPS.length - 1;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-phosphor/40 bg-panel shadow-xl p-4">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm text-phosphor-bright">{current.title}</span>
        <span className="text-[10px] text-[var(--ink-faint)] shrink-0 ml-2">
          {step + 1} / {TOUR_STEPS.length}
        </span>
      </div>
      <p className="text-xs text-[var(--ink-dim)] leading-relaxed">{current.body}</p>
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onNext} className="btn-primary btn text-xs">
          {last ? "Got it" : "Next"}
        </button>
        {/* Skip stays available on every step, not just the first. Someone who wants out on step 4
            should not have to click through to the end to get there. */}
        {!last && (
          <button onClick={onSkip} className="text-xs text-[var(--ink-faint)] hover:text-ink transition-colors">
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
