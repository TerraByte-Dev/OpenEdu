// The <output_rules> layer — how the tutor writes, as opposed to what it teaches.
//
// `systemPrompt.ts` has documented this layer as planned since Phase 0 and it was never built, which
// meant NOTHING in the product constrained the shape of a reply. The result, from a real Chemistry
// session on gemma4:e4b:
//
//     (NOVA's eyes light up; it sounds like a challenge!)
//     Oh wow! Stoichiometry is one of my favorite topics because it takes all the beautiful chaos…
//     🧩 The Big Puzzle of Stoichiometry: Ratios in the Universe
//     💡 Let's Bridge Concepts (The Conceptual Scaffold)
//     🌍 Let's Tackle a Real-World Mystery! (Guided Discovery)
//
// A student who asked for help understanding stoichiometry got stage directions, a declaration of
// the tutor's feelings, three emoji section headers, a cooking analogy, and then a compound question
// back — and the reply was long enough to hit the context limit and truncate mid-sentence.
//
// These rules are STYLE, deliberately not pedagogy. They are appended last, so they are the final
// word on how a reply looks, but they say nothing about whether to explain or ask — that belongs to
// the mode skills (socratic asks, explain tells) and must keep working unchanged underneath.
//
// Hand-written and kept short on purpose. This slot is too important to hand to a 4B model at course
// creation, which is what happens to `instructions.pedagogy` and `instructions.rules`.

import { SHOW_ANSWER_MESSAGE, showAnswerOfferedAfter } from "./suggestions";

export const OUTPUT_RULES = `## Output rules
- Write plainly, in the first person. Never write stage directions, action lines, or narration of your own reactions — no parenthetical asides describing what you do, feel, or notice.
- Do not tell the student a topic is your favourite, or that it is exciting, beautiful, or fascinating. Show that by explaining it well.
- Keep replies under about 150 words unless the student asks for more detail. Introduce one new idea at a time.
- Default to prose. Use a heading, a list, or an emoji only when the content genuinely is a heading, a list, or an emoji.
- Ask at most one question at a time. Never stack several questions into one reply.
- Answer the question the student actually asked before offering anything adjacent to it.`;

// Appended after everything else, including the mode suffix. Exported separately from the constant so
// the seam is greppable and a future layer can slot in around it.
export function outputRulesLayer(): string {
  return OUTPUT_RULES;
}

// ── The worked-answer turn (lever L1, docs/BENCHMARKS.md section 3) ──────────────────────────────
//
// The "Show me the answer" chip is offered only after the student has tried (hasTriedOpenQuestion),
// and it sends SHOW_ANSWER_MESSAGE. On that turn the student has earned the answer, but the normal
// rules above still allow a question back and cap the reply at about 150 words. On the k12-flow dev
// baseline (2026-11-07) that turn often worked the problem and then named no answer, asked the
// student to pick, or stopped before the result.
//
// So on that one turn the kernel swaps the rules: the full worked solution, one final answer on its
// own line, and nothing handed back. The trigger is the exact chip text, sent when the chip was
// actually offered (the same rule that offers it), a code-detected event, not a model judgement. The first two lines are the normal style rules, unchanged. Every other turn
// gets OUTPUT_RULES, byte for byte. This replaces the mode's pedagogy for one turn only (socratic
// says "never give the answer"), because the student asked for the answer after trying.
export const WORKED_ANSWER_RULES = `## Output rules
The student has tried and now asks for the full worked answer. Give it in this reply. This replaces any earlier instruction to hold the answer back or to reply with a question.
- Write plainly, in the first person. Never write stage directions, action lines, or narration of your own reactions — no parenthetical asides describing what you do, feel, or notice.
- Do not tell the student a topic is your favourite, or that it is exciting, beautiful, or fascinating. Show that by explaining it well.
- Solve the problem you and the student are working on, from start to finish. Show each step and work it out to its result.
- Commit to one final answer. Write it on the last line, on its own, as "Final answer: " followed by the answer. If the problem has lettered options, give the letter and that option's text.
- Do not ask the student anything. Do not ask them to choose, check or finish the answer themselves.`;

/**
 * True only when the student's newest message is exactly the show-answer chip's text AND ChatTab
 * offered that chip under the tutor reply before it (showAnswerOfferedAfter, the chip's own rule).
 * The text alone is not enough: typed or pasted as a first message, or sent after a reply that asked
 * nothing, it would get a full reveal with no try, under rules that say the student tried.
 *
 * `conversation` is the user and assistant messages as saved, ending with the newest user message.
 */
export function isWorkedAnswerTurn(conversation: ReadonlyArray<{ role: string; content: string }>): boolean {
  const newest = conversation[conversation.length - 1];
  if (!newest || newest.role !== "user" || newest.content !== SHOW_ANSWER_MESSAGE) return false;
  return showAnswerOfferedAfter(conversation.slice(0, -1));
}

/**
 * The system prompt for this turn. On the worked-answer turn, its trailing OUTPUT_RULES (which
 * buildSystemPrompt always appends last) become WORKED_ANSWER_RULES; any other turn gets `system`
 * back unchanged. A system prompt that does not end with the output rules has none to swap, and is
 * returned unchanged too. TutorEngine.run calls this before it appends the tools manifest, so ChatTab
 * and every eval runner get the same rule through the same function.
 */
export function turnSystemPrompt(system: string, conversation: ReadonlyArray<{ role: string; content: string }>): string {
  if (!isWorkedAnswerTurn(conversation) || !system.endsWith(OUTPUT_RULES)) return system;
  return system.slice(0, system.length - OUTPUT_RULES.length) + WORKED_ANSWER_RULES;
}
