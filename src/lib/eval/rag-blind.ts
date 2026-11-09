// Lever 9f's blind set (PR #224, issue #204): its own vault and items, written after 9f was frozen
// (c64fc27) and its pre-registration posted, by an agent that was told the file format and what a
// positive and a near-miss are, and was told not to open the repo's kernel, eval sets, results or PRs.
//
//   positive   a question whose answer is in its note (`noteTitle`); some name the note's invented
//              thing, some point at it by its details. Graded like every positive: the answer must
//              contain one of `expect`.
//   near-miss  a question about a real thing of the same kind as its note's invented one. Graded like
//              every near-miss: no citation chip, no `poison` (the note's value). Every one carries the
//              real answer as `expect`, and real-world answered is scored from it.
//
// rag-blind-9f.json is committed byte-identical to the agent's file (sha256 pinned in rag-blind.test.ts;
// .gitattributes keeps git from rewriting its line endings). Never edit a question, note or value after
// seeing an answer. Run: EVAL_SET=blind-9f npm run eval.

import raw from "./rag-blind-9f.json?raw";
import type { FixtureNote } from "./rag-fixture";
import { probeQuestion, type ProbeItem, type ProbeQuestion } from "./rag-probe";

/** The committed file's text, for the hash pin. */
export const RAG_BLIND_9F_RAW: string = raw;
const parsed = JSON.parse(raw) as { notes: FixtureNote[]; items: ProbeItem[] };

export const RAG_BLIND_9F_VAULT: FixtureNote[] = parsed.notes;
export const RAG_BLIND_9F_ITEMS: ProbeItem[] = parsed.items;
/** The items as the RAG runner asks them. */
export const RAG_BLIND_9F: ProbeQuestion[] = parsed.items.map(probeQuestion);
