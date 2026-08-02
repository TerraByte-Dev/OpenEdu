import { useState, useEffect, useCallback } from "react";
import type { Flashcard } from "../types";
import { getDueFlashcards, getFlashcards, updateFlashcardAfterReview, createFlashcard, deleteFlashcard } from "../lib/db";
import { review, type FlashcardGrade } from "../lib/srs";

interface ReviewTabProps {
  courseId: string;
  level: number;
}

const GRADES: { grade: FlashcardGrade; label: string; hint: string; cls: string }[] = [
  { grade: "again", label: "Again", hint: "forgot", cls: "border-red-500/40 text-red-300 hover:bg-red-500/10" },
  { grade: "hard", label: "Hard", hint: "barely", cls: "border-amber-500/40 text-amber-300 hover:bg-amber-500/10" },
  { grade: "good", label: "Good", hint: "got it", cls: "border-phosphor/40 text-phosphor-ink hover:bg-[rgb(var(--phosphor-rgb)/0.10)]" },
  { grade: "easy", label: "Easy", hint: "too easy", cls: "border-green-500/40 text-green-300 hover:bg-green-500/10" },
];

export default function ReviewTab({ courseId, level }: ReviewTabProps) {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Manual add form
  const [showAdd, setShowAdd] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const due = await getDueFlashcards(courseId, new Date().toISOString(), 50);
    const all = await getFlashcards(courseId);
    setQueue(due);
    setTotal(all.length);
    setIdx(0);
    setRevealed(false);
    setReviewedCount(0);
    setLoading(false);
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const card = queue[idx];

  const grade = async (g: FlashcardGrade) => {
    if (!card) return;
    const sched = review(
      { ease: card.ease, interval_days: card.interval_days, reps: card.reps, lapses: card.lapses },
      g,
      new Date(),
    );
    await updateFlashcardAfterReview(card.id, sched);
    setReviewedCount((n) => n + 1);
    setRevealed(false);
    setIdx((i) => i + 1);
  };

  const addCard = async () => {
    if (!front.trim() || !back.trim()) return;
    await createFlashcard({ courseId, front: front.trim(), back: back.trim(), level, source: "manual" });
    setFront("");
    setBack("");
    setShowAdd(false);
    await load();
  };

  const removeCurrent = async () => {
    if (!card) return;
    await deleteFlashcard(card.id);
    setRevealed(false);
    setQueue((q) => q.filter((_, i) => i !== idx));
    setTotal((t) => Math.max(0, t - 1));
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-[var(--ink-faint)]">Loading flashcards…</div>;
  }

  const done = idx >= queue.length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl mx-auto">
        {/* Header / counts */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-ink">Review</h2>
            <p className="text-xs text-[var(--ink-faint)]">
              {done ? `${reviewedCount} reviewed this session` : `${queue.length - idx} due · `}
              {total} card{total === 1 ? "" : "s"} total
            </p>
          </div>
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="px-3 py-1.5 rounded-lg border border-[var(--rule)] text-[var(--ink-dim)] text-xs hover:border-phosphor/50 hover:text-ink transition-colors"
          >
            {showAdd ? "Cancel" : "+ New card"}
          </button>
        </div>

        {/* Manual add form */}
        {showAdd && (
          <div className="mb-5 p-4 rounded-xl border border-[var(--rule)] bg-panel-lite/40 space-y-2">
            <input
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="Front (question)"
              className="w-full px-3 py-2 rounded-lg bg-panel-lite border border-[var(--rule)] text-ink text-sm focus:outline-none focus:border-phosphor"
            />
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="Back (answer)"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-panel-lite border border-[var(--rule)] text-ink text-sm focus:outline-none focus:border-phosphor resize-none"
            />
            <button
              onClick={addCard}
              disabled={!front.trim() || !back.trim()}
              className="px-4 py-2 rounded-lg btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium disabled:opacity-40 transition-colors"
            >
              Add card
            </button>
          </div>
        )}

        {/* Card / done state */}
        {done ? (
          <div className="text-center py-12 px-6 rounded-2xl border border-[var(--rule)] bg-panel-lite/30">
            <div className="text-4xl mb-3">🗂️</div>
            <p className="text-ink text-sm font-medium mb-1">
              {total === 0 ? "No flashcards yet" : "All caught up"}
            </p>
            <p className="text-[var(--ink-faint)] text-xs">
              {total === 0
                ? "Cards appear here when the tutor makes them, when you add one, or after a promotion test."
                : "Nothing is due right now. Come back later or add a card to review."}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--rule)] bg-panel overflow-hidden">
            {/* Progress bar */}
            <div className="h-1 bg-lcd">
              <div className="h-full bg-[rgb(var(--phosphor-rgb)/0.5)] transition-all" style={{ width: `${(idx / queue.length) * 100}%` }} />
            </div>
            <div className="p-6">
              <div className="min-h-[120px] flex items-center justify-center text-center">
                <p className="text-lg text-ink leading-relaxed whitespace-pre-wrap">{card.front}</p>
              </div>

              {revealed && (
                <div className="mt-4 pt-4 border-t border-[var(--rule)] text-center">
                  <p className="text-sm text-phosphor-ink leading-relaxed whitespace-pre-wrap">{card.back}</p>
                </div>
              )}
            </div>

            <div className="px-6 pb-5">
              {!revealed ? (
                <button
                  onClick={() => setRevealed(true)}
                  className="w-full px-4 py-2.5 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-sm font-medium transition-colors"
                >
                  Show answer
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {GRADES.map((g) => (
                    <button
                      key={g.grade}
                      onClick={() => grade(g.grade)}
                      className={`flex flex-col items-center px-2 py-2.5 rounded-xl border text-sm font-medium transition-colors ${g.cls}`}
                    >
                      {g.label}
                      <span className="text-[10px] opacity-70">{g.hint}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--ink-faint)]">
                <span>Card {idx + 1} of {queue.length} due</span>
                <button onClick={removeCurrent} className="hover:text-red-300 transition-colors">Delete card</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
