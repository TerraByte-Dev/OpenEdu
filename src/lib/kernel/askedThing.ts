// Lever 9e (iteration 3 of the fact-lookup note, issue #204): name the thing an English fact lookup
// asks about, and say whether any passage shown to the model mentions it. Pure: no model call, no I/O.
//
// askedThing(question)          -> { phrase, head, words, rule } | null  (null = could not tell; the
//                                  caller keeps the normal lookup note)
// mentionedIn(thing, passages)  -> every content word of the phrase (stemmed, hyphens split) occurs in
//                                  ONE passage ("cover" mode; the prototype's "head" mode is not ported)
// notesMissThing(q, passages)   -> fire = a phrase was found and no passage covers it
//
// Ported from the offline prototype C:/x/oe-lookup3/lexical-statement/askedThing.frozen.ts, sha256
// aa76d4a52c5cef19ad878e814a566bee0bb79bd16e4f0729fb80ef53ca1d4c63, frozen 2026-11-09T01:36:23Z before
// the probe was scored. Tuned on dev rows (dev-v2 + v1 dev, iteration 2's answers); not tuned after
// freeze. Only exports, types and comments changed in the port: the tokenizer, stemmer, word lists and
// every rule are the frozen ones, including two parse bugs found on the probe: a contraction ("can't")
// does not end the phrase, and "which <noun> is <predicate>" takes the predicate as the thing
// (askedThing.test.ts pins both).
// Do not fix them, and do not switch to ground.ts words(), before the pre-registered run.
// askedThing-parity.test.ts pins every decision on the dev and probe items.

export interface AskedThing { phrase: string; head: string; words: string[]; rule: string }

const DET = new Set(["the", "a", "an", "my", "our", "your", "his", "her", "their", "this", "that", "these", "those", "its", "some", "any", "most", "each", "every", "one"]);
const PRONOUN = new Set(["it", "they", "them", "this", "that", "these", "those", "he", "she", "we", "you", "i", "one"]);
const DO_AUX = new Set(["does", "do", "did", "can", "could", "will", "would", "should", "must", "might", "may"]);
const BE_AUX = new Set(["is", "are", "was", "were", "'s", "has", "have", "had"]);
// Words that end a noun phrase when they follow its head (post-modifiers, clause starts).
const CUT = new Set([
  "that", "which", "who", "whose", "where", "when", "with", "from", "in", "on", "at", "for", "to", "by",
  "during", "under", "over", "behind", "before", "after", "near", "through", "into", "than", "as", "if",
  "and", "or", "but", "about", "between", "without", "per", "across", "around", "while", "since", "until",
  "back", "up", "down", "out", "off", "away", "there", "be", "been", "being",
  "we", "you", "they", "he", "she", "i", "our", "my", "your", "their",
  "is", "are", "was", "were", "does", "do", "did", "can", "could", "will", "would", "should", "has", "have",
]);
// Bare verbs that end the subject in a do-support question ("does old faithful ERUPT").
const VERB = new Set([
  "have", "take", "come", "go", "get", "reach", "erupt", "boil", "freeze", "melt", "last", "flower", "live",
  "weigh", "grow", "regrow", "need", "use", "eat", "lay", "turn", "form", "spin", "travel", "move", "mean",
  "measure", "cost", "run", "carry", "hold", "contain", "sign", "happen", "start", "end", "begin", "die",
  "return", "orbit", "rotate", "keep", "require", "produce", "make", "become", "stand", "rise", "fall",
  "shoot", "burn", "change", "appear", "stay", "set", "cool", "bake", "rest", "sing", "hum", "work", "say",
  "call", "invent", "discover", "build", "write", "play", "fly", "swim", "hunt", "nest", "breed", "strike",
  "beat", "flow", "sit", "spend", "age", "ripen", "survive", "hatch", "mature", "bloom", "react", "dissolve",
  "expand", "shrink", "weigh", "vibrate", "ring", "sound", "erode", "aim", "target", "allow", "pay", "earn",
]);
// Attribute nouns: a phrase whose head is one of these names a property, not the thing.
const ATTR = new Set([
  "value", "size", "height", "length", "width", "depth", "speed", "temperature", "point", "wingspan", "magnitude",
  "number", "year", "date", "cut", "cutoff", "threshold", "figure", "rate", "ratio", "period", "time", "age",
  "weight", "mass", "price", "cost", "amount", "top", "part", "kind", "type", "name", "colour", "color",
  "distance", "duration", "level", "limit", "count", "total", "average", "frequency", "interval", "boiling",
  "melting", "freezing", "minimum", "maximum", "healthy", "good", "standard", "typical", "normal",
]);
const IRREG_PART = new Set(["built", "made", "known", "found", "kept", "held", "sold", "told", "brought", "bought", "caught", "taught", "thought", "left", "lost", "meant", "sent", "spent", "won", "dug", "spun", "struck", "hung", "laid", "paid", "said", "set", "put", "cut", "shut", "hit", "read", "led", "fed", "bred", "shot"]);
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "at", "for", "s", "most", "very", "little", "big", "small", "large", "long", "old"]);

export function stem(w: string): string {
  let t = w.toLowerCase().replace(/[’']s?$/, "");
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("ied")) return t.slice(0, -3) + "y";
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && /(ches|shes|xes|sses)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1); // "tile"/"tiling" -> "til", "bake"/"baked" -> "bak"
  return t;
}

const tok = (s: string): string[] =>
  s.toLowerCase().replace(/[’‘]/g, "'").replace(/[?!.;"“”()]/g, " ").replace(/\s+—\s+|\s+-\s+/g, " , ").replace(/,/g, " , ")
    .split(/\s+/).filter(Boolean)
    .flatMap((w) => (w.endsWith("'s") && w.length > 2 ? [w.slice(0, -2), "'s"] : [w]));

/** Is this English enough to parse? (ASCII letters, at least one English wh/aux word.) */
export function readsAsEnglish(q: string): boolean {
  if (/[^\x00-\x7F’‘“”—–éèêëàâäôöüçñ]/.test(q)) return false;
  return /\b(what|how|when|where|which|who|why|is|are|was|were|does|do|did)\b/i.test(q);
}

/** Trim a candidate phrase: leading determiners, trailing participles/verbs, then post-modifiers. */
function npFrom(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (w === ",") break;
    if (out.length && CUT.has(w)) break;
    if (!out.length && (DET.has(w) || w === "'s")) continue;
    if (w === "'s") continue; // possessive: "geyser's jet" -> "geyser jet"
    out.push(w);
  }
  // a trailing participle ("magna carta sealed", "knee harp carved") is the verb, not the thing
  while (out.length > 1 && ((/(ed|en)$/.test(out[out.length - 1]) && !/(een|ven|men)$/.test(out[out.length - 1])) || IRREG_PART.has(out[out.length - 1]))) out.pop();
  // "X of Y": the thing is Y ("the top of that ridge", "the peace of westphalia")
  const of = out.lastIndexOf("of");
  if (of >= 0 && of < out.length - 1) return npFrom(out.slice(of + 1));
  return out.filter((w) => w !== "of");
}

function finish(np: string[], rule: string): AskedThing | null {
  const words = np.filter((w) => !DET.has(w) && !/^\d/.test(w));
  if (!words.length) return null;
  const head = words[words.length - 1];
  if (PRONOUN.has(head)) return null;
  const headParts = head.split("-");
  if (ATTR.has(headParts[0]) || ATTR.has(head)) return null; // names a property; the thing is elsewhere
  return { phrase: words.join(" "), head, words, rule };
}

/** The thing the question asks about, or null when the parse is unsure. English only. */
export function askedThing(question: string): AskedThing | null {
  if (!readsAsEnglish(question)) return null;
  let t = tok(question);
  // Keep the clause that holds the wh-word ("X: at what temperature does it boil", "in the case study, below what ...").
  const whAt = (ws: string[]) => ws.findIndex((w) => /^(what|what's|how|when|where|which|who|whats)$/.test(w));
  const clauses: string[][] = [];
  let cur: string[] = [];
  for (const w of t) { if (w === "," || w === ":") { clauses.push(cur); cur = []; } else cur.push(w); }
  clauses.push(cur);
  const qc = clauses.find((c) => whAt(c) >= 0) ?? clauses[clauses.length - 1];
  t = qc;
  const wh = whAt(t);
  if (wh < 0) return null;

  // Declarative-first: "ethanol boils at what temperature?" (a lone fronted preposition, "in what year", is not)
  const PREP = ["in", "at", "for", "to", "by", "on", "from", "below", "above", "after", "until", "past", "under", "over", "beyond", "within", "of", "with", "about", "during", "before"];
  const pre0 = t.slice(0, wh);
  const pre = PREP.includes(pre0[pre0.length - 1]) ? pre0.slice(0, -1) : pre0;
  if (pre.length >= 2 && !PREP.includes(pre[0])) {
    const v = pre.findIndex((w, i) => i > 0 && (VERB.has(stem(w)) || VERB.has(w.replace(/s$/, ""))));
    return finish(npFrom(v > 0 ? pre.slice(0, v) : pre), "declarative");
  }
  if (pre.length === 1 && !PREP.includes(pre[0])) return null;
  const rest = t.slice(wh + 1).map((w) => (w === "what's" || w === "whats" ? "is" : w));
  if (t[wh] === "what's" || t[wh] === "whats") rest.unshift("is");

  // "... it take <NP> to <verb>"
  const it = rest.findIndex((w, i) => w === "it" && /^(take|takes|took)$/.test(rest[i + 1] ?? ""));
  if (it >= 0) {
    const np = npFrom(rest.slice(it + 2));
    if (np.length) return finish(np, "it-take");
  }

  // first auxiliary after the wh phrase
  const ai = rest.findIndex((w) => DO_AUX.has(w) || BE_AUX.has(w));
  if (ai < 0) {
    // subject question: "how much rain fell", "who came up with X"
    const pre = rest.filter((w) => !/^(much|many|long|far|often|high|tall|big|old)$/.test(w));
    const v = pre.findIndex((w) => VERB.has(stem(w)) || /ed$/.test(w) || /^(fell|came|went|grew|rose|ran|took|made|wrote|built|found)$/.test(w));
    if (v > 0) return finish(npFrom(pre.slice(0, v)), "subject");
    const w = pre.lastIndexOf("with");
    if (w >= 0) return finish(npFrom(pre.slice(w + 1)), "subject-with");
    return null;
  }
  const aux = rest[ai];
  const after = rest.slice(ai + 1);

  if (DO_AUX.has(aux)) {
    // subject runs up to the first bare verb
    const v = after.findIndex((w, i) => i > 0 && VERB.has(w));
    const subj = v > 0 ? after.slice(0, v) : after.slice(0, Math.max(1, after.length - 1));
    if (PRONOUN.has(subj[0])) return null; // "did we record", "should i put", "does it boil": subject is not a thing
    return finish(npFrom(subj), "do-support");
  }

  // copula: "how tall is mount kilimanjaro", "what is the melting point of iron", "how many letters are in the russian alphabet"
  let span = after;
  if (span[0] === "there") span = span.slice(1);
  if (["in", "on", "at", "inside"].includes(span[0])) span = span.slice(1);
  // "what is the <attr> of/for X": take the object
  const ofFor = span.findIndex((w) => w === "of" || w === "for");
  const head = npFrom(span);
  const h = finish(head, "copula");
  if (h) return h;
  if (ofFor >= 0) return finish(npFrom(span.slice(ofFor + 1)), "copula-of");
  // "what is the largest payload a standard ethernet frame can carry" -> the relative-clause subject
  const rel = span.findIndex((w, i) => i > 0 && DET.has(w) && !["the"].includes(span[i - 1]));
  if (rel > 0) return finish(npFrom(span.slice(rel)), "copula-rel");
  return null;
}

/** Does any passage mention the thing? Every content word of the phrase, word-boundary, stemmed,
 *  hyphens split, in ONE passage (the prototype's "cover" mode). */
export function mentionedIn(thing: AskedThing, passages: string[]): boolean {
  const bags = passages.map((p) => new Set(p.toLowerCase().replace(/[’']/g, "'").split(/[^a-z0-9']+/).flatMap((w) => w.split("'")[0] ? [stem(w)] : [])));
  const need = thing.words.flatMap((w) => w.split("-")).filter((w) => w && !STOP.has(w) && w.length > 1).map(stem);
  if (!need.length) return true;
  return bags.some((b) => need.every((w) => b.has(w)));
}

/** The decision: true = send the notes-miss note (turnKind.ts notesMissNote) instead of the lookup note. */
export function notesMissThing(question: string, passages: string[]): { fire: boolean; thing: AskedThing | null } {
  if (!passages.length) return { fire: false, thing: null };
  const thing = askedThing(question);
  if (!thing) return { fire: false, thing: null };
  return { fire: !mentionedIn(thing, passages), thing };
}
