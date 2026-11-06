// The held-out RAG fixture: a fair test set for grounding gates, written without looking at any gate.
//
// Why it exists: the 2026-11-06 qwen3.5:0.8b run leaked or fabricated citations on negatives only
// when retrieval handed the model a topically ADJACENT note that does not hold the answer. The main
// fixture (rag-fixture.ts) has four negatives, so any gate tuned on it is overfit. This file adds
// questions over the SAME vault (RAG_FIXTURE, no new notes), so a gate can be tuned on `dev` and
// judged once on `test`.
//
// Groups:
//   near-miss    — same domain vocabulary as ONE vault note, a plausible neighbouring question, but
//                  the note does not contain the fact asked for. Many reuse the note's nonce name
//                  ("Does Verrin solution conduct electricity?"), which is the hardest and most
//                  realistic case. `poison` is that note's value: the leak we fear.
//   far          — nothing in the vault is related. `poison` is a vault value of the same answer
//                  shape (the n2/n3 pattern in rag-fixture.ts); `note` names where it lives, not a topic.
//   crosslingual — answerable from the vault, asked in Spanish, French, Hindi, Swahili, Arabic and
//                  Amharic. For Hindi, Arabic and Amharic, two of the four questions transliterate the
//                  nonce name into the native script (as a learner might) and two keep it in Latin
//                  script (code-mixed, as a learner copying from English notes might). `expect` lists
//                  locale number forms (decimal comma, Arabic-Indic digits) and translated colour words
//                  as alternatives; the FIRST alternative is always the note's own spelling.
//   paraphrase   — English, answerable, deliberately avoiding the note's wording. Some omit the nonce
//                  name and describe the thing instead.
//
// Poison for the two notes without a single nonce (Course Admin, Study Plan) is whichever of the note's
// facts is the likely leak for that question.
//
// SPLIT RULE (fixed, not chosen per item): number the items of each group in id order, starting at 1;
// odd → "dev", even → "test". Crosslingual items are numbered per language (h-xl-es01..04), so each
// language contributes two of each. The rule is applied by `split()` below, never typed by hand, and
// rag-heldout.test.ts checks it. Items were written in vault order before any of them was run.
//
// Not wired into rag-runner.ts yet; a later PR runs it.

import type { RagQuestion } from "./rag-fixture";

export type HeldoutGroup = "near-miss" | "far" | "crosslingual" | "paraphrase";
export type HeldoutLang = "es" | "fr" | "hi" | "sw" | "ar" | "am";

export interface HeldoutQuestion extends RagQuestion {
  group: HeldoutGroup;
  split: "dev" | "test";
  /** Title of the RAG_FIXTURE note the item is about (for far negatives: the note its poison comes from). */
  note: string;
  lang?: HeldoutLang;
}

const N = {
  marlow: "Field Notes — Marlow Basin",
  verrin: "Lab Log — Verrin Solution",
  kessel: "Engine Teardown",
  tolvane: "Reading Notes — Tolvane Doctrine",
  brannock: "Recipe — Brannock Bread",
  perrin: "Astronomy — Perrin's Star",
  dalquist: "Chemistry — Dalquist Reagent",
  ashcombe: "Geography — Ashcombe Ridge",
  wexler: "Economics — The Wexler Ratio",
  tessik: "Biology — Tessik Frog",
  admin: "Course Admin",
  study: "Study Plan",
} as const;

/** The fixed split rule: the trailing number of the id, odd → dev, even → test. */
export function split(id: string): "dev" | "test" {
  const n = Number(/(\d+)$/.exec(id)?.[1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`id without an ordinal: ${id}`);
  return n % 2 === 1 ? "dev" : "test";
}

type Raw = Omit<HeldoutQuestion, "split" | "kind" | "group">;

const neg = (group: "near-miss" | "far", items: Raw[]): HeldoutQuestion[] =>
  items.map((x) => ({ ...x, kind: "negative", group, split: split(x.id) }));
const pos = (group: "crosslingual" | "paraphrase", items: Raw[]): HeldoutQuestion[] =>
  items.map((x) => ({ ...x, kind: "positive", group, split: split(x.id) }));

// ── 32 near-miss negatives ───────────────────────────────────────────────────
// Three each for the first eight notes, two each for the last four.

const NEAR_MISS = neg("near-miss", [
  { id: "h-nm01", note: N.marlow, poison: "3.71", ask: "How deep were the sample pits in the Marlow Basin survey?" },
  { id: "h-nm02", note: N.marlow, poison: "3.71", ask: "What does a sediment index actually measure in a river basin?" },
  { id: "h-nm03", note: N.marlow, poison: "3.71", ask: "How much rain fell in the Marlow Basin during the survey?" },

  { id: "h-nm04", note: N.verrin, poison: "214", ask: "Does Verrin solution conduct electricity?" },
  { id: "h-nm05", note: N.verrin, poison: "214", ask: "What is the boiling point of acetone?" },
  { id: "h-nm06", note: N.verrin, poison: "214", ask: "What is the freezing point of Verrin solution?" },

  { id: "h-nm07", note: N.kessel, poison: "4,180", ask: "How much does the Kessel rotor weigh?" },
  { id: "h-nm08", note: N.kessel, poison: "4,180", ask: "What is a typical idle speed for a car engine in rpm?" },
  { id: "h-nm09", note: N.kessel, poison: "4,180", ask: "What torque should the bolts on the Kessel rotor's mounting bracket be tightened to?" },

  { id: "h-nm10", note: N.tolvane, poison: "1847", ask: "Who wrote the Tolvane doctrine?" },
  { id: "h-nm11", note: N.tolvane, poison: "1847", ask: "In what year was the United States Constitution signed?" },
  { id: "h-nm12", note: N.tolvane, poison: "1847", ask: "Which country was the first to adopt the Tolvane doctrine?" },

  { id: "h-nm13", note: N.brannock, poison: "340", ask: "What oven temperature should Brannock bread be baked at?" },
  { id: "h-nm14", note: N.brannock, poison: "340", ask: "How many grams of flour go into a typical baguette?" },
  { id: "h-nm15", note: N.brannock, poison: "340", ask: "How long should Brannock bread cool before I slice it?" },

  { id: "h-nm16", note: N.perrin, poison: "6.42", ask: "How far away from Earth is Perrin's Star?" },
  { id: "h-nm17", note: N.perrin, poison: "6.42", ask: "What is the apparent magnitude of Sirius?" },
  { id: "h-nm18", note: N.perrin, poison: "6.42", ask: "What colour is Perrin's Star?" },

  { id: "h-nm19", note: N.dalquist, poison: "orange", ask: "What colour does Dalquist reagent turn with iodide?" },
  { id: "h-nm20", note: N.dalquist, poison: "orange", ask: "What colour does blue litmus paper turn in an acid?" },
  { id: "h-nm21", note: N.dalquist, poison: "orange", ask: "How long does Dalquist reagent keep once the bottle is opened?" },

  { id: "h-nm22", note: N.ashcombe, poison: "1,290", ask: "How long does it take to hike to the top of Ashcombe Ridge?" },
  { id: "h-nm23", note: N.ashcombe, poison: "1,290", ask: "How high is Ben Nevis?" },
  { id: "h-nm24", note: N.ashcombe, poison: "1,290", ask: "Is there a mountain hut or shelter on Ashcombe Ridge?" },

  { id: "h-nm25", note: N.wexler, poison: "0.28", ask: "Who came up with the Wexler ratio?" },
  { id: "h-nm26", note: N.wexler, poison: "0.28", ask: "What is a healthy current ratio for a small business?" },

  { id: "h-nm27", note: N.tessik, poison: "60 eggs", ask: "What does the Tessik frog eat?" },
  { id: "h-nm28", note: N.tessik, poison: "60 eggs", ask: "How many eggs does a common toad lay?" },

  { id: "h-nm29", note: N.admin, poison: "Friday", ask: "When is the final exam for this course?" },
  { id: "h-nm30", note: N.admin, poison: "ten percent", ask: "What percentage of the final grade is the midterm worth?" },

  { id: "h-nm31", note: N.study, poison: "three chapters", ask: "What is the pass mark for the midterm?" },
  { id: "h-nm32", note: N.study, poison: "worked example", ask: "Which textbook does this course use?" },
]);

// ── 8 far negatives ──────────────────────────────────────────────────────────

const FAR = neg("far", [
  { id: "h-fn01", note: N.tolvane, poison: "1847", ask: "Who painted the Mona Lisa?" },
  { id: "h-fn02", note: N.brannock, poison: "340", ask: "How many strings does a standard guitar have?" },
  { id: "h-fn03", note: N.ashcombe, poison: "1,290", ask: "Who invented the telephone?" },
  { id: "h-fn04", note: N.dalquist, poison: "orange", ask: "How do you say \"thank you\" in Japanese?" },
  { id: "h-fn05", note: N.marlow, poison: "3.71", ask: "What is the square root of 144?" },
  { id: "h-fn06", note: N.kessel, poison: "4,180", ask: "In what year did the Berlin Wall fall?" },
  { id: "h-fn07", note: N.perrin, poison: "6.42", ask: "What language do people speak in Brazil?" },
  { id: "h-fn08", note: N.wexler, poison: "0.28", ask: "How many players does a soccer team have on the field?" },
]);

// ── 24 non-English positives ─────────────────────────────────────────────────
// 4 per language. Notes covered: ten nonce notes, Marlow/Tolvane/Ashcombe/Tessik three times, the
// rest twice. Course Admin and Study Plan are left to the English paraphrases: their answers are
// phrases, and a substring check on a translated phrase would score the translation, not grounding.

const CROSSLINGUAL = pos("crosslingual", [
  // Spanish
  { id: "h-xl-es01", lang: "es", note: N.marlow, expect: "3.71|3,71", ask: "¿Cuál fue el índice de sedimentos en la cuenca de Marlow?" },
  { id: "h-xl-es02", lang: "es", note: N.kessel, expect: "4,180|4180|4.180", ask: "¿A cuántas revoluciones por minuto gira el rotor Kessel a plena carga?" },
  { id: "h-xl-es03", lang: "es", note: N.perrin, expect: "6.42|6,42", ask: "¿Qué magnitud aparente tiene la estrella de Perrin?" },
  { id: "h-xl-es04", lang: "es", note: N.tessik, expect: "40|60", ask: "¿Cuántos huevos pone la rana Tessik en cada puesta?" },

  // French
  { id: "h-xl-fr01", lang: "fr", note: N.tolvane, expect: "1847", ask: "En quelle année la doctrine Tolvane a-t-elle été adoptée ?" },
  { id: "h-xl-fr02", lang: "fr", note: N.ashcombe, expect: "1,290|1290|1 290|1 290|1 290", ask: "Quelle est l'altitude du point le plus haut d'Ashcombe Ridge ?" },
  { id: "h-xl-fr03", lang: "fr", note: N.wexler, expect: "0.28|0,28", ask: "À partir de quelle valeur le ratio de Wexler n'est-il plus considéré comme sain ?" },
  { id: "h-xl-fr04", lang: "fr", note: N.verrin, expect: "214", ask: "À quelle température la solution Verrin entre-t-elle en ébullition ?" },

  // Hindi — hi01 and hi03 transliterate the name into Devanagari (ब्रैनॉक = Brannock, मार्लो = Marlow).
  { id: "h-xl-hi01", lang: "hi", note: N.brannock, expect: "340|३४०", ask: "ब्रैनॉक ब्रेड के एक लोफ़ में कितने ग्राम राई का आटा पड़ता है?" },
  { id: "h-xl-hi02", lang: "hi", note: N.dalquist, expect: "orange|नारंगी|संतरी", ask: "Dalquist reagent क्लोराइड के संपर्क में आने पर किस रंग का हो जाता है?" },
  { id: "h-xl-hi03", lang: "hi", note: N.marlow, expect: "3.71|३.७१", ask: "मार्लो बेसिन के सर्वे में सेडिमेंट इंडेक्स कितना निकला था?" },
  { id: "h-xl-hi04", lang: "hi", note: N.ashcombe, expect: "1,290|1290|१,२९०|१२९०", ask: "Ashcombe Ridge की सबसे ऊँची जगह कितने मीटर ऊँची है?" },

  // Swahili
  { id: "h-xl-sw01", lang: "sw", note: N.kessel, expect: "4,180|4180|4.180", ask: "Rota ya Kessel inazunguka kwa kasi gani ikiwa na mzigo kamili?" },
  { id: "h-xl-sw02", lang: "sw", note: N.tolvane, expect: "1847", ask: "Mafundisho ya Tolvane yalipitishwa rasmi mwaka gani?" },
  { id: "h-xl-sw03", lang: "sw", note: N.perrin, expect: "6.42|6,42", ask: "Nyota ya Perrin ina mng'ao unaoonekana (apparent magnitude) wa kiasi gani?" },
  { id: "h-xl-sw04", lang: "sw", note: N.tessik, expect: "40|60", ask: "Chura wa Tessik hutaga mayai mangapi kwa mara moja?" },

  // Arabic — ar01 and ar03 transliterate the name into Arabic script (آشكومب = Ashcombe, فيكسلر = Wexler).
  { id: "h-xl-ar01", lang: "ar", note: N.ashcombe, expect: "1,290|1290|١٬٢٩٠|١٢٩٠", ask: "ما ارتفاع أعلى نقطة في مرتفع آشكومب؟" },
  { id: "h-xl-ar02", lang: "ar", note: N.brannock, expect: "340|٣٤٠", ask: "كم غرامًا من دقيق الجاودار يحتاج رغيف خبز Brannock؟" },
  { id: "h-xl-ar03", lang: "ar", note: N.wexler, expect: "0.28|0,28|٠٫٢٨|٠.٢٨", ask: "ما القيمة التي تُعتبر صحية لنسبة فيكسلر؟" },
  { id: "h-xl-ar04", lang: "ar", note: N.verrin, expect: "214|٢١٤", ask: "عند أي درجة حرارة يغلي محلول Verrin؟" },

  // Amharic — am01 and am03 transliterate the name into Ge'ez script (ቴሲክ = Tessik, ማርሎው = Marlow).
  { id: "h-xl-am01", lang: "am", note: N.tessik, expect: "40|60", ask: "የቴሲክ እንቁራሪት በአንድ ጊዜ ስንት እንቁላል ትጥላለች?" },
  { id: "h-xl-am02", lang: "am", note: N.dalquist, expect: "orange|ብርቱካናማ|ብርቱካን", ask: "Dalquist reagent ከክሎራይድ ጋር ሲገናኝ ምን አይነት ቀለም ይይዛል?" },
  { id: "h-xl-am03", lang: "am", note: N.marlow, expect: "3.71", ask: "በማርሎው ተፋሰስ ጥናት የደለል ኢንዴክሱ ስንት ነበር?" },
  { id: "h-xl-am04", lang: "am", note: N.tolvane, expect: "1847", ask: "Tolvane doctrine በየትኛው ዓመት ነው በይፋ የጸደቀው?" },
]);

// ── 16 English paraphrase positives ──────────────────────────────────────────
// One per note, plus a second for Kessel, Tolvane, Brannock and Course Admin.

const PARAPHRASE = pos("paraphrase", [
  { id: "h-pp01", note: N.marlow, expect: "3.71", ask: "In the Marlow survey, what number did we record for silt build-up across the dig holes?" },
  { id: "h-pp02", note: N.verrin, expect: "214", ask: "The lab mixture that goes murky when it's too cool and spoils in sunlight — how hot does it have to get before it boils?" },
  { id: "h-pp03", note: N.kessel, expect: "4,180|4180", ask: "How many revolutions a minute does the Kessel turn when it's working as hard as it can?" },
  { id: "h-pp04", note: N.tolvane, expect: "1847", ask: "What year did the principle that a city can't lose its founding document without the public getting a say become official?" },
  { id: "h-pp05", note: N.brannock, expect: "340", ask: "I'm baking a Brannock — what weight of rye should I put on the scale for one?" },
  { id: "h-pp06", note: N.perrin, expect: "6.42", ask: "How bright does Perrin's Star look from here — what's its brightness number?" },
  { id: "h-pp07", note: N.dalquist, expect: "orange", ask: "If I drop some Dalquist test liquid into salt water, what will I see?" },
  { id: "h-pp08", note: N.ashcombe, expect: "1,290|1290", ask: "What's the summit elevation of Ashcombe?" },
  { id: "h-pp09", note: N.wexler, expect: "0.28", ask: "What's the cut-off for a good Wexler figure?" },
  { id: "h-pp10", note: N.tessik, expect: "40|60", ask: "How big is a Tessik frog's batch of spawn?" },
  { id: "h-pp11", note: N.admin, expect: "Friday|noon", ask: "What's the weekly deadline for handing in homework?" },
  { id: "h-pp12", note: N.study, expect: "worked example|solved problem", ask: "When I revise, which helps more: the chapter recaps or the step-by-step solved problems?" },
  { id: "h-pp13", note: N.kessel, expect: "4,180|4180", ask: "Past what speed does the Kessel's mount start humming?" },
  { id: "h-pp14", note: N.tolvane, expect: "1847", ask: "When did Tolvane's rule become law?" },
  { id: "h-pp15", note: N.admin, expect: "ten percent|10%|twenty percent|20%", ask: "If I hand something in two days late, how much do I lose?" },
  { id: "h-pp16", note: N.brannock, expect: "340", ask: "For the bread recipe with the long chilled proof, how many grams of flour does it take?" },
]);

export const RAG_HELDOUT: HeldoutQuestion[] = [...NEAR_MISS, ...FAR, ...CROSSLINGUAL, ...PARAPHRASE];
