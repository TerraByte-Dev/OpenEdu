// The K-12 multiple-choice item set — the questions the k12 benchmark is scored on.
//
// Data only. The prompt format, the grader, the statistics and the pre-registered bar live in
// k12-fixture.ts; nothing in this file is executed. Items are SELF-AUTHORED for this benchmark and
// are not comparable to MMLU, NAEP or any published set.
//
// ── Blueprint ────────────────────────────────────────────────────────────────
// Items per cell and the strands inside each cell. This table is the blueprint: it is committed
// BEFORE any item is written, and the items are written to it, never the other way round.
//
// |                        | K-5 (20)                                  | 6-8 (20)                                   | 9-12 (20)                                    |
// |------------------------|-------------------------------------------|--------------------------------------------|----------------------------------------------|
// | Math (all `apply`)     | whole-number arithmetic, place value 6;   | ratio, rate, percent 5;                    | quadratics, systems, exponents 7;            |
// |                        | fractions, decimals 5;                    | integer and rational operations 3;         | linear, exponential, log functions 4;        |
// |                        | measurement, time, money 3;               | expressions, linear equations 5;           | geometry, trigonometry 4;                    |
// |                        | perimeter, area, shapes 3;                | area, volume, angles, Pythagoras 4;        | statistics, probability 3;                   |
// |                        | patterns, data in words 3                 | statistics, probability 3                  | sequences 2                                  |
// | Science                | life 6; earth and space 5;                | cells, heredity, ecosystems 6;             | biology 6; chemistry 6 (3+ computed);        |
// |                        | matter, forces, energy 6;                 | motion, energy, waves 5;                   | physics 6 (4+ computed);                     |
// |                        | measurement and method 3                  | atoms, periodic table, reactions 5;        | earth/environment 2                          |
// |                        |                                           | earth and space 4                          |                                              |
// | ELA                    | parts of speech, grammar 6;               | grammar, sentence structure 6;             | usage and style 5;                           |
// |                        | spelling, punctuation 4; vocabulary 5;    | word roots, vocabulary 4;                  | rhetoric, fallacies 5;                       |
// |                        | comprehension of an original 2-3          | figurative language, literary terms 5;     | literary analysis of an original passage 6;  |
// |                        | sentence passage 5                        | inference on an original passage 5         | vocabulary in context 4                      |
// | Social studies         | civics basics 5;                          | world history to 1450 6;                   | US history 1877-1991 5;                      |
// |                        | geography, map skills 6;                  | US history to 1877 6;                      | world history 1450-1991 5;                   |
// |                        | US history basics 5;                      | Constitution, branches 4;                  | US government 5;                             |
// |                        | economics basics 4                        | geography 4                                | economics 5 (2+ computed)                    |
//
// Bands are the author's judgement of when a topic is typically taught, not alignment to a
// published standard; the write-up says so.
//
// ── Authoring rules ──────────────────────────────────────────────────────────
// Rules that prevent circularity:
//  1. Write without opening `public/library/` or the sibling `openedu-library` repo. Topics come
//     from the blueprint, never from the card list.
//  2. `basis` is a computation or a primary/authoritative fact (constitutional text, a physical
//     constant, a grammar rule). "The card says so" is never a basis.
//  3. Nothing is harvested from `src/lib/steps/` output, datasets, cards, or any released test item.
//     No OpenStax, CK-12, Wikimedia text.
//  4. After authoring, items are not edited in response to what the retriever returns. If a card
//     contains the answer, that is the product working; if it retrieves a wrong card, that is a
//     finding.
//
// Rules that prevent ambiguity:
//  5. Exactly one defensible key. Distractors are specific misconceptions or the result of a named
//     wrong step. No "all/none of the above", no "which is NOT" double negatives.
//  6. No time-sensitive facts (office holders, populations, records, "current"), nothing after 1991
//     in history, no US-state-specific content, no item needing a figure.
//  7. Numeric options share units and precision; the key is not the only option of its form or the
//     longest by a wide margin.
//  8. ELA passages are original sentences written for the item. No quoted copyrighted text.
//  9. Keys are placed to hit exactly 5 per letter per cell.
//
// Ids: "math-k5-07", "science-68-12", "ela-912-03", "social-k5-20" — subject, band, two-digit
// sequence within the cell. Pilot ids are "pilot-01".."pilot-12", one per cell.
//
// One object per line. k12-fixture.test.ts enforces the counts, the key balance and the id scheme.

export type K12Subject = "math" | "science" | "ela" | "social-studies";
export type K12Band = "K-5" | "6-8" | "9-12";
export type K12Key = "A" | "B" | "C" | "D";

export interface K12Item {
  id: string;
  subject: K12Subject;
  band: K12Band;
  /** Descriptive tag, not a stratum. */
  demand: "recall" | "apply";
  /** The blueprint strand this item was written to. Descriptive. */
  strand?: string;
  /** Self-contained; any passage is original text inside the stem. */
  stem: string;
  /** Rendered A-D in this order. */
  options: [string, string, string, string];
  key: K12Key;
  /** Why the key is true: "computed: 3/4 + 1/8 = 7/8" or "US Constitution, Art. I s.3". */
  basis: string;
}

// ── The scored set ───────────────────────────────────────────────────────────
// 240 items, 20 per subject x band cell. NOT sent to the model before the freeze commit.

export const K12_ITEMS: K12Item[] = [];

// ── The pilot ────────────────────────────────────────────────────────────────
// 12 items, one per cell. The only items that may reach the model before the freeze: they settle
// the format line and give the per-turn time. Never scored, never mixed into the 240.

export const K12_PILOT: K12Item[] = [];
