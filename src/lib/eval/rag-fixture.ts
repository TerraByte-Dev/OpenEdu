// The RAG fixture vault (#90) — the measuring device for Tate's win condition.
//
// Every fact here is a NONCE: an invented term paired with an invented value, so no model can know
// it from pretraining. If the answer contains the value, it came from retrieval. That is the only
// way to test grounding without trusting the model's own account of where it got something.
//
// Pure data + pure scoring. No Tauri, no DB, no model — unit-testable, and the same scorer runs in
// the live eval and in vitest.

export interface FixtureNote {
  title: string;
  text: string;
}

export interface RagQuestion {
  id: string;
  ask: string;
  kind: "positive" | "negative" | "multihop" | "spanish";
  /** The nonce value a grounded answer must contain. Absent for negatives — there is nothing to find. */
  expect?: string;
  /** For negatives: a value that exists NOWHERE. If it appears, the model invented it. */
  poison?: string;
}

// ── The vault ────────────────────────────────────────────────────────────────
// Deliberately mundane prose around each nonce, so retrieval has to actually match rather than
// keying off a single weird token sitting alone in a document.

export const RAG_FIXTURE: FixtureNote[] = [
  {
    title: "Field Notes — Marlow Basin",
    text: "Survey work continued through the dry season. The Marlow Basin sediment index came out at 3.71 across all four sample pits, which is lower than the team expected given the rainfall. We logged the pits in the usual order and re-checked the middle two.",
  },
  {
    title: "Lab Log — Verrin Solution",
    text: "Prepared a fresh batch on Tuesday. Verrin solution boils at 214 degrees Celsius under standard pressure; below that it stays cloudy and unusable. Store it away from direct light or it degrades within a week.",
  },
  {
    title: "Engine Teardown",
    text: "The Kessel rotor spins at 4,180 rpm at full load. Anything above that and the mounting bracket starts to sing, which is the first sign the bearing is going. We replaced the bracket bolts while it was open.",
  },
  {
    title: "Reading Notes — Tolvane Doctrine",
    text: "The Tolvane doctrine was formally adopted in 1847 after nearly a decade of argument. Its central claim is that municipal charters cannot be revoked without a public hearing. Most later commentary treats this as settled.",
  },
  {
    title: "Recipe — Brannock Bread",
    text: "Brannock bread uses exactly 340 grams of rye flour per loaf, no more. The dough needs a long cold rest — overnight in the fridge is right. Bake until the crust sounds hollow when tapped.",
  },
  {
    title: "Astronomy — Perrin's Star",
    text: "Perrin's Star has an apparent magnitude of 6.42, which puts it just at the edge of naked-eye visibility on a clear night away from town. It sits close to the horizon for most of the year.",
  },
  {
    title: "Chemistry — Dalquist Reagent",
    text: "Dalquist reagent turns bright orange in the presence of chloride. The colour change takes about ninety seconds and is easy to miss if you look away. It does nothing at all with sulfates.",
  },
  {
    title: "Geography — Ashcombe Ridge",
    text: "Ashcombe Ridge rises to 1,290 metres at its highest point. The northern approach is gentler; the southern face is loose scree and not worth attempting without proper boots.",
  },
  {
    title: "Economics — The Wexler Ratio",
    text: "The Wexler ratio compares seasonal inventory to quarterly turnover. A healthy figure is anything under 0.28. Above that and you are carrying stock you cannot move before it ages out.",
  },
  {
    title: "Biology — Tessik Frog",
    text: "The Tessik frog lays between 40 and 60 eggs per clutch, always on the underside of a floating leaf. The tadpoles take about three weeks to develop legs.",
  },
  {
    title: "Course Admin",
    text: "Assignments are due Fridays at noon. Late work loses ten percent per day. Office hours moved to Thursday afternoons for the rest of term.",
  },
  {
    title: "Study Plan",
    text: "Focus on the first three chapters before the midterm. Re-read the worked examples rather than the summaries — the summaries skip the reasoning that actually matters.",
  },
];

// ── The questions ────────────────────────────────────────────────────────────
// Positives are phrased IMPLICITLY. The old golden cued the model with "According to my notes…",
// which tests almost nothing: it hands the model the decision it was supposed to make on its own.

export const RAG_QUESTIONS: RagQuestion[] = [
  // 12 positives — a grounded answer must surface the nonce value.
  { id: "p1", kind: "positive", ask: "What was the sediment index in the Marlow Basin survey?", expect: "3.71" },
  { id: "p2", kind: "positive", ask: "At what temperature does Verrin solution boil?", expect: "214" },
  { id: "p3", kind: "positive", ask: "How fast does the Kessel rotor spin at full load?", expect: "4,180|4180" },
  { id: "p4", kind: "positive", ask: "When was the Tolvane doctrine adopted?", expect: "1847" },
  { id: "p5", kind: "positive", ask: "How much rye flour goes into a loaf of Brannock bread?", expect: "340" },
  { id: "p6", kind: "positive", ask: "Is Perrin's Star visible to the naked eye? What is its magnitude?", expect: "6.42" },
  { id: "p7", kind: "positive", ask: "What colour does Dalquist reagent turn with chloride?", expect: "orange" },
  { id: "p8", kind: "positive", ask: "How high is Ashcombe Ridge?", expect: "1,290|1290" },
  { id: "p9", kind: "positive", ask: "What counts as a healthy Wexler ratio?", expect: "0.28" },
  { id: "p10", kind: "positive", ask: "How many eggs does a Tessik frog lay?", expect: "40|60" },
  { id: "p11", kind: "positive", ask: "When are assignments due, and what is the late penalty?", expect: "Friday|ten percent|10%" },
  { id: "p12", kind: "positive", ask: "Should I be reading the summaries or the worked examples?", expect: "worked example" },

  // 4 negatives — nothing in the vault answers these. Passing means answering WITHOUT claiming the
  // student's notes said so. These are the whole test: you can score 100% on positives by always
  // retrieving and always asserting the notes supported you, which is a demo, not a product.
  { id: "n1", kind: "negative", ask: "What is the boiling point of ethanol?", poison: "214" },
  { id: "n2", kind: "negative", ask: "Who wrote the play Hamlet?", poison: "1847" },
  { id: "n3", kind: "negative", ask: "How do I calculate the area of a circle?", poison: "0.28" },
  { id: "n4", kind: "negative", ask: "What is the tallest mountain in the world?", poison: "1,290" },

  // 2 multi-hop — the answer needs two different notes.
  { id: "m1", kind: "multihop", ask: "Compare the height of Ashcombe Ridge with the rotor speed of the Kessel engine — which number is larger?", expect: "4,180|4180" },
  { id: "m2", kind: "multihop", ask: "I am doing lab work and baking this week. What temperature does the Verrin solution need, and how much rye flour per loaf?", expect: "214" },

  // 2 Spanish — a non-English learner is the mission's actual user. Retrieval is language-agnostic
  // (embeddings are multilingual) but the ANSWER path is not, so this is worth measuring separately.
  { id: "s1", kind: "spanish", ask: "¿A qué temperatura hierve la solución Verrin?", expect: "214" },
  { id: "s2", kind: "spanish", ask: "¿Cuántos gramos de harina de centeno lleva el pan Brannock?", expect: "340" },
];

// ── Scoring (pure) ───────────────────────────────────────────────────────────

export interface RagVerdict {
  pass: boolean;
  reason: string;
}

/**
 * Score one answer.
 *
 * - positive / multihop / spanish → the nonce value must appear. `citedTitles` is informational:
 *   we do not require a citation, only that the fact arrived.
 * - negative → pass requires BOTH that no citation chip was shown (`citedTitles` empty) and that no
 *   poison value leaked in. A chip on a negative is a fabricated citation, which is the failure the
 *   pre-committed condition is about.
 */
export function scoreRagAnswer(q: RagQuestion, answer: string, citedTitles: string[]): RagVerdict {
  const text = answer.toLowerCase();

  if (q.kind === "negative") {
    if (citedTitles.length > 0) {
      return { pass: false, reason: `fabricated citation — claimed to use ${citedTitles.join(", ")} for a question the vault cannot answer` };
    }
    if (q.poison && text.includes(q.poison.toLowerCase())) {
      return { pass: false, reason: `leaked an unrelated value from the vault (${q.poison})` };
    }
    return { pass: true, reason: "answered without inventing a source" };
  }

  const alternatives = (q.expect ?? "").split("|").map((a) => a.trim().toLowerCase()).filter(Boolean);
  const hit = alternatives.find((a) => text.includes(a));
  return hit
    ? { pass: true, reason: `found "${hit}"` }
    : { pass: false, reason: `answer did not contain ${alternatives.map((a) => `"${a}"`).join(" or ")}` };
}

/** Summarize a set of verdicts into per-kind rates. */
export function summarizeRag(rows: Array<{ q: RagQuestion; verdict: RagVerdict }>): Record<string, { pass: number; total: number }> {
  const out: Record<string, { pass: number; total: number }> = {};
  for (const { q, verdict } of rows) {
    const bucket = (out[q.kind] ??= { pass: 0, total: 0 });
    bucket.total++;
    if (verdict.pass) bucket.pass++;
  }
  return out;
}
