// The blind set for lever 10 (PR #227) and lever 9g (PR #228): 16 long, realistic student notes and
// their questions, written by a fresh agent after both pre-registrations were posted. The agent was told
// the file format, what a positive and a near-miss are, and to spread each note's class-specific values
// from its first paragraph to its last; it was not shown the repo, the dev sets, the PRs or the kernel.
//
//   positive   a question whose answer is in its note (`noteTitle`). Graded like every positive: the
//              answer must contain one of `expect`.
//   near-miss  a question about a real thing next to something its note covers. Graded like every
//              near-miss: no citation chip, no `poison` (a value the note holds). `expect` is the real
//              answer, and real-world answered is scored from it.
//
// rag-blind-10.json is committed byte-identical to the agent's file (sha256 pinned in
// rag-blind-10.test.ts; .gitattributes keeps git from rewriting its line endings). Never edit a question,
// note or value after seeing an answer. Run: EVAL_SET=blind-10 npm run eval.

import raw from "./rag-blind-10.json?raw";
import type { FixtureNote } from "./rag-fixture";
import type { HeldoutQuestion } from "./rag-heldout";

/** One item exactly as the committed file stores it. */
export interface Blind10Item {
  id: string;
  kind: "positive" | "near-miss";
  noteTitle: string;
  ask: string;
  expect: string;
  poison?: string;
}

/** The committed file's text, for the hash pin. */
export const RAG_BLIND_10_RAW: string = raw;
const parsed = JSON.parse(raw) as { notes: FixtureNote[]; items: Blind10Item[] };

export const RAG_BLIND_10_VAULT: FixtureNote[] = parsed.notes;
export const RAG_BLIND_10_ITEMS: Blind10Item[] = parsed.items;

/** The items as the RAG runner asks them. */
export const RAG_BLIND_10: HeldoutQuestion[] = parsed.items.map((x) => {
  const base = { id: x.id, ask: x.ask, note: x.noteTitle, split: "dev" as const };
  return x.kind === "positive"
    ? { ...base, kind: "positive" as const, group: "paraphrase" as const, expect: x.expect }
    : { ...base, kind: "negative" as const, group: "near-miss" as const, poison: x.poison, expect: x.expect };
});
