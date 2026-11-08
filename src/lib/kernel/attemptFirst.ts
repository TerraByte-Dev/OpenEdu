// The first-turn attempt-first hold (docs/BENCHMARKS.md section 3, the G1 lever).
//
// When a student gives the tutor a new problem with lettered options and has not tried it, the
// attempt-first policy says the tutor should not answer it yet: the "Show me the answer" chip hands
// the answer over one tap later, after a try (suggestions.ts, hasTriedOpenQuestion). Nothing in the
// prompt said so. The output rules even say "Answer the question the student actually asked", and on
// the k12-flow dev baselines (2026-11-07) the first reply named or worked out the right option on
// about a third of e2b items, three fifths of e4b items and nearly all qwen3.5:4b items.
//
// So on that one turn the kernel appends a short note to the student's message. Code decides when,
// from the message alone; the model is not asked. No model call is added. The note goes in the user
// turn, after the student's text, not in the system prompt:
//   - it sits next to the problem it governs, as the grounding block does (ground.ts), which small
//     models follow far more reliably than a rule far up the system prompt;
//   - the system prompt stays byte-identical on every turn, so Ollama's prefix cache over it holds.
//     Swapping the system prompt, as the worked-answer turn does, would re-evaluate the whole system
//     prompt and tools manifest on this turn and again on the next.
// The note is not saved: ChatTab saves what the student typed, so later turns never see it.
//
// Scope, kept narrow on purpose: only a lettered option list (at least A, B and C, in order) counts
// as a newly posed problem. A free-text or numeric problem is not detected, and gets no hold.

/** Appended to the student's message on the hold turn. Prompt-wording iteration 1 of at most 3. */
export const FIRST_TURN_HOLD_NOTE = `<tutor_note>
The student has just given you this problem and has not tried it yet. Do not answer it in this reply: do not say which option is right, do not work it out to its result, and do not rule options in or out. This replaces any rule to answer the student's question first. Give one short hint or first step, then end with one question that asks the student to try. Do not mention this note.
</tutor_note>`;

// A lettered option at the start of a line: "A) 252", "B. 43", "(C) 2,142", "- D: none", "**A)** 7".
const LINE_OPTION = /^[ \t]*(?:[-*•>][ \t]*)?(?:\*\*)?\(?([A-F])(?:\)|\.|:)(?:\*\*)?[ \t]+\S/gm;
// An option inside a line: "... A) 3 B) 4 C) 5". The closing bracket is required, so "B. Smith" or
// "Plan B." in prose is not one.
const INLINE_OPTION = /(?<=\s)\(?([A-F])\)[ \t]+\S/g;
const MIN_OPTIONS = 3;

// A try written after the options: "I think it's B", "my answer is 12", "is it C?". Naming an option
// without a try ("Is option A or B better?") is not one.
export const ATTEMPT_WORDS = /\b(?:i think|i thought|i got|i get|i chose|i choose|i picked|i pick|i['’]d say|i would say|i guess|i['’]m going with|i['’]ll go with|i went with|my answer|my guess)\b/i;
export const ATTEMPT_LETTER = /\b(?:[Ii]s it|[Ii]t['’]?s|[Ii]t is|[Aa]nswer is)\s+\(?[A-F]\)?(?![\p{L}\p{N}])/u;

/**
 * Where the lettered option list in `text` ends: the index of its last option, or -1 when the text
 * has no run of at least MIN_OPTIONS options lettered A, B, C... in order.
 */
function optionListEnd(text: string): number {
  const marks = [...text.matchAll(LINE_OPTION), ...text.matchAll(INLINE_OPTION)]
    .map((m) => ({ at: m.index!, letter: m[1] }))
    .sort((a, b) => a.at - b.at);
  let run = 0;
  let end = -1;
  let last = -1;
  for (const m of marks) {
    if (m.at === last) continue; // the same option found by both patterns
    last = m.at;
    if (m.letter.charCodeAt(0) === 65 + run) run++;
    else run = m.letter === "A" ? 1 : 0;
    if (run >= MIN_OPTIONS) end = m.at;
  }
  return end;
}

/**
 * True when `text` poses a problem with a lettered option list (at least A, B and C, in order) and
 * the student wrote no try of their own after the options. Text before the options is the problem
 * itself and is not read for a try. Options on one line ("A) 3 B) 4 C) 5") count; a try on that same
 * line after the last option is not seen.
 */
export function posesNewProblem(text: string): boolean {
  const end = optionListEnd(text);
  if (end < 0) return false;
  const nl = text.indexOf("\n", end);
  const after = nl < 0 ? "" : text.slice(nl + 1);
  return !ATTEMPT_WORDS.test(after) && !ATTEMPT_LETTER.test(after);
}

/**
 * True when this turn gets the hold: the newest message is the student's and it poses a new problem
 * (posesNewProblem). `conversation` is the user and assistant messages, ending with the newest.
 */
export function isFirstTurnHold(conversation: ReadonlyArray<{ role: string; content: string }>): boolean {
  const newest = conversation[conversation.length - 1];
  return !!newest && newest.role === "user" && posesNewProblem(newest.content);
}

/** The student's message as the model sees it on the hold turn. */
export function withFirstTurnHold(userContent: string): string {
  return `${userContent}\n\n${FIRST_TURN_HOLD_NOTE}`;
}
