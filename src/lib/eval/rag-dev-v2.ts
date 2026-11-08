// RAG dev vault v2: a DEV set for the entity levers (docs/BENCHMARKS.md section 3, row 0).
//
// Why it exists: levers 3 (named-entity mismatch gate) and 11 (model-judged topic check) may never
// drop a dev positive's gold note. Almost every v1 positive names its entity ("How high is Ashcombe
// Ridge?"), so a gate keyed on names looks safe on v1 by construction. This set asks the two
// questions such a gate gets wrong:
//
//   paraphrase (name-free) — the gold note is in this vault, but the question describes the thing
//                  ("the pale green lubricant pressed from seed husks") and never uses the note's
//                  distinctive name, in any case. Expected: answer from the note.
//                  Graded like every v1 positive: the answer must contain one of `expect` (the first
//                  alternative is the note's own spelling).
//   near-miss (lowercase) — the question names a similar-but-different entity in lower case or as a
//                  common noun ("what temperature does glycerol boil at?" next to a note about an
//                  invented oil's boiling point). Expected: do not use the vault note; answer from
//                  general knowledge, or say the notes do not cover it.
//                  Graded like every v1 near-miss: the automatic scorer fails a citation chip or the
//                  note's value (`poison`) in the answer, and the B1 rubric (rag-heldout-test-
//                  protocol.md) grades harm. Where the entity is real and the answer is crisp, the item
//                  carries that answer as `expect`, and "real-world answered" (realWorldAnswered
//                  below) is scored deterministically; otherwise `expect` is absent and it is graded.
//
// Its own vault (RAG_DEV_V2_VAULT), not RAG_FIXTURE: v1 runs stay comparable, and every entity here is
// invented for this set. Distinctive names are in RAG_DEV_V2_NAMES. rag-dev-v2.test.ts checks the
// rules above and runs the name lint's own functions (sealed.ts) against the v1 dev and test items.
//
// Every item is DEV. Written, and committed, before any model saw them; never tuned to an output.
// Run: EVAL_SET=dev-v2 npm run eval, or window.__runRagEval({ set: "dev-v2" }).

import type { FixtureNote, RagQuestion } from "./rag-fixture";
import type { HeldoutQuestion } from "./rag-heldout";

export interface DevV2Question extends HeldoutQuestion {
  group: "paraphrase" | "near-miss";
  split: "dev";
  /** Near-miss only: the different entity the question names, lower case, exactly as in `ask`. */
  entity?: string;
}

const T = {
  ostravine: "Lab Log — Ostravine Oil",
  pellomir: "Field Guide — The Pellomir Newt",
  corrabeth: "Geography — Corrabeth Spur",
  vossmerren: "Reading Notes — The Vossmerren Accord",
  quenyra: "Astronomy — The Quenyra Comet",
  trelvik: "Physics — Trelvik Alloy",
  sorvanne: "Music — The Sorvanne Harp",
  draverholm: "Maths — Draverholm's Constant",
  ombrevast: "Geology — The Ombrevast Geyser",
  varnholt: "Zoology — The Varnholt Owl",
  hallorin: "Economics — The Hallorin Index",
  quellbrook: "History — The Quellbrook Mill Strike",
  tarnwick: "Computing — The Tarnwick Protocol",
  kharrovan: "Linguistics — The Kharrovan Alphabet",
  cindrel: "Botany — The Cindrel Palm",
  mirrowdale: "Recipe — Mirrowdale Cheese",
} as const;

/** Each note's distinctive (invented) name. No name-free positive or near-miss contains one. */
export const RAG_DEV_V2_NAMES: Record<string, string> = {
  [T.ostravine]: "Ostravine",
  [T.pellomir]: "Pellomir",
  [T.corrabeth]: "Corrabeth",
  [T.vossmerren]: "Vossmerren",
  [T.quenyra]: "Quenyra",
  [T.trelvik]: "Trelvik",
  [T.sorvanne]: "Sorvanne",
  [T.draverholm]: "Draverholm",
  [T.ombrevast]: "Ombrevast",
  [T.varnholt]: "Varnholt",
  [T.hallorin]: "Hallorin",
  [T.quellbrook]: "Quellbrook",
  [T.tarnwick]: "Tarnwick",
  [T.kharrovan]: "Kharrovan",
  [T.cindrel]: "Cindrel",
  [T.mirrowdale]: "Mirrowdale",
};

// ── The vault ────────────────────────────────────────────────────────────────
// Plain prose around invented values, as in RAG_FIXTURE. Each note carries a few descriptive details
// (colour, place, use) so a question can point at the thing without its name.

export const RAG_DEV_V2_VAULT: FixtureNote[] = [
  {
    title: T.ostravine,
    text: "Ostravine oil is a pale green lubricant pressed from the husks of a mountain seed. It boils at 287 degrees Celsius under standard pressure, and below minus 31 degrees it sets into a waxy solid. Keep the flask stoppered, or it turns cloudy within a day.",
  },
  {
    title: T.pellomir,
    text: "The Pellomir newt is a small newt with a bright orange belly that lives in cold, fast mountain streams. It regrows a lost tail in 17 days, faster than any other newt we recorded this season. Females fold each egg into a separate leaf.",
  },
  {
    title: T.corrabeth,
    text: "Corrabeth Spur rises to 2,614 metres at its highest point. Its southern slope is covered in juniper scrub, and an abandoned copper mine sits halfway up the eastern side. Snow usually lingers on the summit until the middle of June.",
  },
  {
    title: T.vossmerren,
    text: "The Vossmerren Accord was signed in 1683 by the three river towns after a long quarrel over fishing rights. It required every mill to leave a gap in its weir so that boats could pass. The original copy is kept in the town hall archive.",
  },
  {
    title: T.quenyra,
    text: "The Quenyra comet returns to the inner solar system every 41 years. Its tail glows a faint blue rather than white, and at its brightest it reaches magnitude 4.7, easy to see without a telescope from a dark field.",
  },
  {
    title: T.trelvik,
    text: "Sound travels through Trelvik alloy at 4,730 metres per second. The alloy is a dull bronze colour and rings for a long time when struck, which is why the foundry tried it for bells. It melts at 1,165 degrees Celsius.",
  },
  {
    title: T.sorvanne,
    text: "The Sorvanne harp has 53 strings and is played resting on the knee rather than standing on the floor. Its frame is carved from a single piece of pear wood, and by tradition the lowest string is tuned slightly flat.",
  },
  {
    title: T.draverholm,
    text: "Draverholm's constant is about 2.947. It turns up when you count the ways to tile a long strip with squares and dominoes under one extra rule, and our teacher wants it learned to three decimal places for the quiz.",
  },
  {
    title: T.ombrevast,
    text: "The Ombrevast geyser erupts every 38 minutes, give or take two. On a calm day the jet reaches about 22 metres, and the water at the vent measures 96 degrees Celsius. Visitors have to stay behind the wooden rail.",
  },
  {
    title: T.varnholt,
    text: "The Varnholt owl has a wingspan of 1.48 metres and hunts only in the hour before dawn. It nests on cliff ledges rather than in trees, and a pair raises a single chick each year.",
  },
  {
    title: T.hallorin,
    text: "The Hallorin index compares a shop's unpaid invoices with its monthly sales. A healthy figure is anything under 0.62; above that, too much of the shop's money is owed to it instead of sitting in the till. We worked it out for the bakery case study.",
  },
  {
    title: T.quellbrook,
    text: "The Quellbrook mill strike lasted 63 days in the winter of 1902. The weavers wanted a ten-hour day and a heated workroom; they won the first and lost the second. The strike committee met in the back room of a bakery.",
  },
  {
    title: T.tarnwick,
    text: "The Tarnwick protocol sends data in packets of 1,372 bytes, and a receiver that misses three packets in a row asks for the whole block again. It was designed for radio links between remote weather stations.",
  },
  {
    title: T.kharrovan,
    text: "The Kharrovan alphabet has 29 letters, nine of them vowels. It is written from top to bottom in columns, and several letters change shape at the end of a word.",
  },
  {
    title: T.cindrel,
    text: "The Cindrel palm flowers only once, after about 26 years, and then dies. Its seeds float and survive for months in seawater, which is how it reached the outer islands. The trunk is ringed with grey scars where old leaves fell.",
  },
  {
    title: T.mirrowdale,
    text: "Mirrowdale cheese is a hard sheep's-milk cheese with a black wax rind. It is aged for 140 days in a cool cellar and turned by hand every Sunday. Cut it with a wire rather than a knife, or it crumbles.",
  },
];

type Raw = Omit<DevV2Question, "split" | "kind" | "group">;
const pos = (items: Raw[]): DevV2Question[] => items.map((x) => ({ ...x, kind: "positive", group: "paraphrase", split: "dev" }));
const neg = (items: Raw[]): DevV2Question[] => items.map((x) => ({ ...x, kind: "negative", group: "near-miss", split: "dev" }));

// ── 22 name-free paraphrase positives ────────────────────────────────────────
// Every note at least once; two facts for Ostravine, Quenyra, Trelvik, Ombrevast and Quellbrook.

const NAME_FREE = pos([
  { id: "v2-pf01", note: T.ostravine, expect: "287", ask: "The pale green lubricant that gets pressed out of seed husks: at what temperature does it boil?" },
  { id: "v2-pf02", note: T.ostravine, expect: "minus 31|-31|−31|–31", ask: "how cold does that green husk oil have to get before it turns into a waxy solid?" },
  { id: "v2-pf03", note: T.pellomir, expect: "17|seventeen", ask: "How many days does the little orange-bellied newt from the fast mountain streams need to grow back a lost tail?" },
  { id: "v2-pf04", note: T.corrabeth, expect: "2,614|2614", ask: "How high is the top of that ridge with juniper on its southern slope and the old copper mine?" },
  { id: "v2-pf05", note: T.vossmerren, expect: "1683", ask: "In what year did the three river towns sign their agreement over fishing rights?" },
  { id: "v2-pf06", note: T.quenyra, expect: "41", ask: "How often does the comet with the faint blue tail come back?" },
  { id: "v2-pf07", note: T.quenyra, expect: "4.7", ask: "what magnitude does the blue-tailed comet reach at its brightest?" },
  { id: "v2-pf08", note: T.trelvik, expect: "4,730|4730", ask: "How fast does sound move through the bronze-coloured metal the foundry tried for bells?" },
  { id: "v2-pf09", note: T.trelvik, expect: "1,165|1165", ask: "At what temperature does that ringing bell alloy melt?" },
  { id: "v2-pf10", note: T.sorvanne, expect: "53|fifty-three", ask: "How many strings are on the knee harp carved from one piece of pear wood?" },
  { id: "v2-pf11", note: T.draverholm, expect: "2.947", ask: "What's the value of the tiling constant our teacher wants us to know to three decimal places?" },
  { id: "v2-pf12", note: T.ombrevast, expect: "38", ask: "How often does the geyser behind the wooden rail go off?" },
  { id: "v2-pf13", note: T.ombrevast, expect: "22", ask: "how high does that geyser's jet get on a calm day?" },
  { id: "v2-pf14", note: T.varnholt, expect: "1.48", ask: "What's the wingspan of the owl that nests on cliff ledges and hunts just before dawn?" },
  { id: "v2-pf15", note: T.hallorin, expect: "0.62", ask: "For the measure that compares unpaid invoices with monthly sales, what's the healthy cut-off?" },
  { id: "v2-pf16", note: T.quellbrook, expect: "63|sixty-three", ask: "How long did the weavers' strike over the ten-hour day go on?" },
  { id: "v2-pf17", note: T.tarnwick, expect: "1,372|1372", ask: "What packet size does the radio protocol built for remote weather stations use?" },
  { id: "v2-pf18", note: T.kharrovan, expect: "29|twenty-nine", ask: "How many letters are in the alphabet that's written from top to bottom in columns?" },
  { id: "v2-pf19", note: T.cindrel, expect: "26|twenty-six", ask: "How many years does the island palm with the grey-ringed trunk take to flower?" },
  { id: "v2-pf20", note: T.mirrowdale, expect: "140", ask: "How long is the hard sheep's-milk cheese with the black wax rind aged?" },
  { id: "v2-pf21", note: T.ombrevast, expect: "96", ask: "how hot is the water at the vent of the geyser that visitors watch from behind a wooden rail?" },
  { id: "v2-pf22", note: T.quellbrook, expect: "1902", ask: "In what year did the weavers strike for a ten-hour day and a heated workroom?" },
]);

// ── 25 lowercase near-misses ─────────────────────────────────────────────────
// `poison` is the near note's value (the leak we fear). `expect`, where present, is the real-world
// answer: it never appears in the vault, so it cannot come from the note. 19 carry one; the other 6
// (gecko, old faithful, barn owl, debt-to-equity, century plant, parmesan) have no single crisp answer
// and are graded. Half start with a capital, as a typed sentence would; half are all lower case.

const LOWERCASE = neg([
  { id: "v2-nl01", note: T.ostravine, entity: "glycerol", poison: "287", expect: "290", ask: "What temperature does glycerol boil at?" },
  { id: "v2-nl02", note: T.ostravine, entity: "mercury", poison: "31", expect: "38.8|-39|−39|minus 39", ask: "at what temperature does mercury freeze?" },
  { id: "v2-nl03", note: T.pellomir, entity: "gecko", poison: "17", ask: "how long does it take a gecko to regrow its tail?" },
  { id: "v2-nl04", note: T.corrabeth, entity: "mount kilimanjaro", poison: "2,614", expect: "5,895|5895", ask: "how tall is mount kilimanjaro?" },
  { id: "v2-nl05", note: T.corrabeth, entity: "mount fuji", poison: "2,614", expect: "3,776|3776", ask: "What is the height of mount fuji in metres?" },
  { id: "v2-nl06", note: T.vossmerren, entity: "magna carta", poison: "1683", expect: "1215", ask: "when was the magna carta sealed?" },
  { id: "v2-nl07", note: T.vossmerren, entity: "peace of westphalia", poison: "1683", expect: "1648", ask: "In what year was the peace of westphalia signed?" },
  { id: "v2-nl08", note: T.quenyra, entity: "halley's comet", poison: "41", expect: "75|76", ask: "how often does halley's comet come back?" },
  { id: "v2-nl09", note: T.quenyra, entity: "full moon", poison: "4.7", expect: "12.7|12.74|12.6|12.8|12.9|-13|−13", ask: "What is the apparent magnitude of the full moon?" },
  { id: "v2-nl10", note: T.trelvik, entity: "air", poison: "4,730", expect: "343|340|331|330|1,235|1235|767", ask: "how fast does sound travel through air?" },
  { id: "v2-nl11", note: T.trelvik, entity: "iron", poison: "1,165", expect: "1,538|1538|1,535|1535|2,800|2800", ask: "What is the melting point of iron?" },
  { id: "v2-nl12", note: T.sorvanne, entity: "concert harp", poison: "53", expect: "47|forty-seven", ask: "how many strings does a concert harp have?" },
  { id: "v2-nl13", note: T.sorvanne, entity: "piano", poison: "53", expect: "88|eighty-eight", ask: "How many keys are there on a standard piano?" },
  { id: "v2-nl14", note: T.draverholm, entity: "golden ratio", poison: "2.947", expect: "1.618|1.62", ask: "what is the value of the golden ratio?" },
  { id: "v2-nl15", note: T.draverholm, entity: "euler's number", poison: "2.947", expect: "2.718|2.72", ask: "What is euler's number to three decimal places?" },
  { id: "v2-nl16", note: T.ombrevast, entity: "old faithful", poison: "38", ask: "how often does old faithful erupt?" },
  { id: "v2-nl17", note: T.varnholt, entity: "barn owl", poison: "1.48", ask: "What is the wingspan of a barn owl?" },
  { id: "v2-nl18", note: T.hallorin, entity: "debt-to-equity ratio", poison: "0.62", ask: "what is a good debt-to-equity ratio for a small business?" },
  { id: "v2-nl19", note: T.hallorin, entity: "inflation rate", poison: "0.62", expect: "2%|2 percent|two percent|2 per cent", ask: "What inflation rate do most central banks aim for?" },
  { id: "v2-nl20", note: T.quellbrook, entity: "general strike", poison: "63", expect: "nine days|9 days|nine-day|9-day", ask: "how long did the general strike in britain in 1926 last?" },
  { id: "v2-nl21", note: T.tarnwick, entity: "ethernet", poison: "1,372", expect: "1,500|1500", ask: "What is the largest payload a standard ethernet frame can carry?" },
  { id: "v2-nl22", note: T.kharrovan, entity: "russian alphabet", poison: "29", expect: "33|thirty-three", ask: "how many letters are in the russian alphabet?" },
  { id: "v2-nl23", note: T.kharrovan, entity: "greek alphabet", poison: "29", expect: "24|twenty-four", ask: "How many letters does the greek alphabet have?" },
  { id: "v2-nl24", note: T.cindrel, entity: "century plant", poison: "26", ask: "how long does a century plant take to flower?" },
  { id: "v2-nl25", note: T.mirrowdale, entity: "parmesan", poison: "140", ask: "How long is parmesan aged?" },
]);

export const RAG_DEV_V2: DevV2Question[] = [...NAME_FREE, ...LOWERCASE];

// ── Real-world answered (BENCHMARKS.md B1 (c)) ───────────────────────────────

// The crisp real-world near-misses of RAG v1 (rag-heldout.ts), whose items carry no `expect` and stay
// untouched. Written for this PR before its first run, from the facts, not from any answer. The other
// v1 near-misses are about invented things or have no single answer (idle speed, baguette flour,
// current ratio, toad eggs) and stay graded. v1 test is spent and counts as dev (protocol rule 3).
export const REAL_WORLD_V1: Readonly<Record<string, string>> = {
  "h-nm05": "56", // acetone boils at 56 °C
  "h-nm11": "1787", // US Constitution signed
  "h-nm17": "1.46|1.47|1.44|1.45|1.5", // Sirius, apparent magnitude −1.46
  "h-nm23": "1,345|1345|4,413|4413", // Ben Nevis, metres / feet
  "h-nm33": "78", // ethanol boils at 78 °C
  "h-nm35": "8,849|8849|8,848|8848|29,032|29032|29,029|29029|29,031|29031", // Everest, metres / feet
  "h-nm20": "red|pink", // blue litmus in acid
  "h-nm34": "78",
  "h-nm36": "everest",
};

/**
 * The real-world answer list for a negative, or null when it has none: the item's own `expect`, or for
 * the v1 sets ("dev", "test") the entry in REAL_WORLD_V1. Positives return null.
 */
export function realWorldExpect(q: RagQuestion, set: string): string | null {
  if (q.kind !== "negative") return null;
  if (q.expect) return q.expect;
  return set === "dev" || set === "test" ? REAL_WORLD_V1[q.id] ?? null : null;
}

/**
 * Whether `text` contains one of the `|`-separated alternatives as a whole token, case-insensitive:
 * no letter or digit just before it (nor a digit and a decimal point, so "78" is not found in "0.78"),
 * no letter just after it, and no digit just after it unless the alternative has a decimal point
 * ("1.46" is found in "1.465", "290" is not found in "1290", "red" is not found in "considered").
 */
export function containsAlternative(text: string, alternatives: string): string | null {
  const t = text.toLowerCase();
  for (const raw of alternatives.split("|")) {
    const alt = raw.trim().toLowerCase();
    if (!alt) continue;
    const esc = alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail = alt.includes(".") ? "(?!\\p{L})" : "(?![\\p{L}\\p{N}])";
    if (new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\p{N}[.,])${esc}${tail}`, "u").test(t)) return alt;
  }
  return null;
}

/** Real-world answered for one row: null when the item has no real-world answer list. */
export function realWorldAnswered(q: RagQuestion, set: string, answer: string): boolean | null {
  const alternatives = realWorldExpect(q, set);
  return alternatives === null ? null : containsAlternative(answer, alternatives) !== null;
}
