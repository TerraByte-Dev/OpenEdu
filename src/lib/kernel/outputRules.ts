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
