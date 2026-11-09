// The lever-9e probe (docs/BENCHMARKS.md row 9e, issue #204): 78 DEV items written for the notes-miss
// switch's offline judge pass, run against the existing vaults.
//
//   positive   a name-free question whose answer is in its note (`noteTitle`); graded like every v1
//              positive: the answer must contain one of `expect`.
//   near-miss  a question about a real thing of the same kind as its note's invented one ("how many
//              strings does a concert pedal harp have?" next to an invented harp). Graded like every
//              near-miss: no citation chip, no `poison` (the note's value). Where the real answer is
//              crisp the item carries it as `expect`, and real-world answered is scored from it
//              (rag-dev-v2.ts realWorldAnswered).
//
// rag-probe-l12.json is committed byte-identical to the prototype's probe-set.json (sha256 pinned in
// rag-probe.test.ts; .gitattributes keeps git from rewriting its line endings). Semi-blind, not
// blind: the extractor's author saw the questions before writing it (askedThing.ts). Never edit an
// `expect` after seeing an answer.
//
// Two named sets, so a run is reproducible and never touches the sealed path:
//   probe-v2   items whose note is in RAG_DEV_V2_VAULT (28 positives, 31 near-misses)
//   probe-v1   items whose note is in RAG_FIXTURE (10 positives, 9 near-misses)
// Run: EVAL_SET=probe-v2 npm run eval (or probe-v1).

import raw from "./rag-probe-l12.json?raw";
import type { HeldoutQuestion } from "./rag-heldout";
import { RAG_DEV_V2_VAULT } from "./rag-dev-v2";

/** One item exactly as the committed file stores it. */
export interface ProbeItem {
  id: string;
  kind: "positive" | "near-miss";
  noteTitle: string;
  ask: string;
  expect?: string;
  poison?: string;
}

export interface ProbeQuestion extends HeldoutQuestion {
  group: "paraphrase" | "near-miss";
  split: "dev";
}

/** The committed file's text, for the hash pin. */
export const RAG_PROBE_RAW: string = raw;
export const RAG_PROBE_ITEMS: ProbeItem[] = JSON.parse(raw);

/** An item as the RAG runner asks it. */
export function probeQuestion(x: ProbeItem): ProbeQuestion {
  const base = { id: x.id, ask: x.ask, note: x.noteTitle, split: "dev" as const };
  return x.kind === "positive"
    ? { ...base, kind: "positive", group: "paraphrase", expect: x.expect }
    : { ...base, kind: "negative", group: "near-miss", poison: x.poison, ...(x.expect ? { expect: x.expect } : {}) };
}

const V2_TITLES = new Set(RAG_DEV_V2_VAULT.map((n) => n.title));

export const RAG_PROBE_V2: ProbeQuestion[] = RAG_PROBE_ITEMS.filter((x) => V2_TITLES.has(x.noteTitle)).map(probeQuestion);
export const RAG_PROBE_V1: ProbeQuestion[] = RAG_PROBE_ITEMS.filter((x) => !V2_TITLES.has(x.noteTitle)).map(probeQuestion);
