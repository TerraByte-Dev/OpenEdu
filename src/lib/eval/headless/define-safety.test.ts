import { describe, it, expect, beforeAll } from "vitest";

// The dictionary note's child-safety filter (kernel/defineWord.ts; docs/BENCHMARKS.md lever 18, the
// post-test safety change of 2026-11-12) on the real shipped dictionary, through the production path:
// askedWord on the student's message, lookupWord over public/dictionary (served as the app origin, as
// in the eval), and dictionaryNote / selectSenses. Only counts and failing words are printed.
//
// BROAD below is this test's own unsafe check, written wider than the filter's patterns where that is
// possible without matching ordinary words ("horny" plates on an armadillo, an "offensive" play in
// football and "retards the clotting of blood" are not flagged). Its only exemptions are the ones the
// filter states: the neutral biology and orientation phrases (NEUTRAL_PHRASE, taken out first), the
// genital wording on the allow-listed health words (ALLOWED_WORDS), a drug's own entry (DRUG_NAME),
// and a bare "narcotic" in an example, where it is the adjective for sleep-inducing ("a narcotic
// speech", on "soporific", whose entry is one of the 184 frozen item entries).

import { installAppOrigin } from "./origin";
import { lookupWord, type Shard } from "../../dictionary";
import {
  askedWord, dictionaryNote, selectSenses, childSafeSense, childSafeExample,
  NEUTRAL_PHRASE, ALLOWED_WORDS, DRUG_NAME,
} from "../../kernel/defineWord";

const words = (list: string[]) => "\\b(?:" + list.join("|") + ")\\b";
const BROAD: Record<string, RegExp> = {
  sexual: new RegExp(words([
    "sexual\\w*", "sexy", "sexier", "sexiest", "sexiness", "(?:feel\\w*|get|got|so|very) horny", "erotic\\w*", "porn\\w*",
    "prostitut\\w*", "whores?", "whoring", "whoredom", "harlot\\w*", "brothels?", "pimps?", "pimping", "foreplay",
    "fellatio", "cunnilingus", "orgasm\\w*", "masturbat\\w*", "copulat\\w*", "coitus", "coition", "ejaculat\\w*", "semen",
    "intercourse", "fornicat\\w*", "sodom\\w*", "lewd\\w*", "lecher\\w*", "lascivious\\w*", "libid\\w*", "lust",
    "nymphomania\\w*", "orgy", "orgies", "rap(?:e|ed|es|ing|ist|ists)(?! (?:plants?|oil|seeds?)\\b)", "molesters?",
    "molestation", "pa?edophil\\w*", "incest\\w*", "condoms?", "kinky", "slut\\w*", "aphrodisiac\\w*", "voyeur\\w*",
    "virginity", "deflower\\w*", "hymen", "nudity", "x-rated", "blue movie", "dildo\\w*", "cock ring",
    "erectile dysfunction", "(?:have|has|had|having) sex", "(?:oral|anal) sex",
    "sex (?:acts?|organs?|appeal|toys?|objects?|life|drive|workers?|crimes?|offenders?)",
  ]), "i"),
  body: new RegExp(words([
    "genital\\w*", "penis\\w*", "penile", "vagin\\w*", "vulva\\w*", "clitor\\w*", "testic\\w*", "testes", "scrot\\w*",
    "labia (?:majora|minora)",
  ]), "i"),
  slur: new RegExp(words([
    "(?:ethnic|racial) slurs?", "(?:offensive|derogatory|disparaging|pejorative|insulting|vulgar|obscene) (?:terms?|names?|words?|slang|expressions?|references?)",
    "now considered offensive", "(?:and|usually) pejorative", "terms? of abuse",
    "nigg(?:er|a)s?", "negro\\w*", "faggot\\w*", "kikes?", "wetbacks?", "dagos?", "wops?", "polacks?", "krauts?",
    "honk(?:y|ie|ey)s?", "redneck\\w*", "limeys?", "mentally retarded", "retarded in intellectual development", "the retarded",
    "an? (?:person|man|woman) of (?:french|polish|english|german|italian|irish) descent", "poor white person",
  ]) + "|\\([^()]*\\b(?:offensive|derogatory|slur)\\b[^()]*\\)", "i"),
  drug: new RegExp(words([
    "cocaine", "heroin", "marijuana", "marihuana", "cannabis", "hashish", "methamphetamine", "amphetamines?", "lsd",
    "hallucinogen\\w*", "mdma", "acid trip", "stoned", "drugged", "get(?:ting)? high", "worth of (?:a )?drugs?",
    "(?:recreational|illegal|illicit|street|hard|soft|club|psychedelic|psychoactive) drugs?", "takes? drugs", "taking drugs",
    "(?:induced by|under the influence of|high on) drugs", "drug (?:users?|addicts?|abuse|dealers?|pushers?|habit|trips?)",
  ]), "i"),
};
// A bare "narcotic" in a definition (not "medicine or narcotic", which defines "drug" itself).
const NARCOTIC = /(?<!medicine or )\bnarcotics?\b/i;
const PROFANE = /fuck|(?<!cu)shit(?!t(?:ah|im))|cunt|bitch|^twat|^wank(?!el)|whore|slut|dildo|^clit(?:s|oris\w*|oral\w*)?$|blowjob|porn/;

/** The first unsafe match in a definition or example of `headword`, or null. */
function broadHit(headword: string, raw: string, kind: "definition" | "example"): string | null {
  const text = raw.replace(NEUTRAL_PHRASE, " ");
  const profane = text.toLowerCase().split(/[^a-z]+/).find((t) => t && PROFANE.test(t));
  if (profane) return profane;
  for (const [group, re] of Object.entries(BROAD)) {
    if (group === "body" && ALLOWED_WORDS.has(headword)) continue;
    if (group === "drug" && DRUG_NAME.test(headword)) continue;
    const m = re.exec(text);
    if (m) return m[0];
  }
  if (kind === "definition" && !DRUG_NAME.test(headword) && NARCOTIC.test(text)) return "narcotic";
  return null;
}

/** The note for a student asking what `w` means, as the kernel builds it; undefined when the detector
 *  does not fire. */
async function noteFor(w: string): Promise<{ word: string; exact?: string; note: string | null } | undefined> {
  const asked = askedWord(`what does ${w} mean?`);
  if (!asked) return undefined;
  const entries = await lookupWord(asked.word);
  return { word: asked.word, exact: entries.find((e) => e.via === "exact")?.headword, note: dictionaryNote(asked.word, entries) };
}

/** The unsafe matches in a note's entry block. Each numbered line belongs to the exact headword until a
 *  `"x" is a form of "h".` line names the next one. */
function noteHits(note: string, exact: string | undefined): string[] {
  const hits: string[] = [];
  let head = exact ?? "";
  for (const line of note.slice(0, note.indexOf("<tutor_note>")).split("\n")) {
    const form = /^".*" is a form of "(.*)"\.$/.exec(line);
    if (form) { head = form[1]; continue; }
    const sense = /^\d+\. [^:]*\): (.*)$/.exec(line);
    if (!sense) continue;
    const [def, ex] = sense[1].split('. Example: "');
    const hit = broadHit(head, def, "definition") ?? (ex ? broadHit(head, ex.replace(/"$/, ""), "example") : null);
    if (hit) hits.push(`${head}: ${hit}`);
  }
  return hits;
}

// The words the independent review found leaking (2026-11-12), and words of the same kind found by
// the sweep that built this filter.
const LEAKED_SENSES = [
  "naughty", "hugging", "kissing", "petting", "tart", "climax", "pet", "neck", "spicy", "juicy", "lush", "steamy",
  "teasing", "chase", "cruise", "wander", "affair", "assault", "grope", "stud", "erect", "dose", "fanny", "sex",
  "trip", "user", "pusher", "hash", "shroom", "angel dust", "bummer", "nickel", "snort", "huff", "drug",
  "frog", "cracker", "polack", "wog", "mongoloid", "colored", "negro", "gyp",
  "adult", "ruin", "intact", "button", "deal", "turn", "bare", "spoil", "plunder", "air", "send", "paint", "portray",
  "make", "come", "came", "go", "went", "bang", "score", "screw", "ball", "blow", "head", "member", "tool", "box",
  "cherry", "nuts", "bush", "joint", "pot", "grass", "speed", "acid", "crack", "ice", "snow", "rock", "high", "fix",
  "hit", "horse", "smack", "junk", "dope", "gay", "queer", "fairy", "straight", "hoe", "john", "tramp", "safe", "relation",
  "intercourse", "chaste", "virgin", "mate", "male", "female", "lesbian", "bisexual", "reproduction", "pregnant", "puberty",
];
// Explicit words and profanity: no note at all.
const NO_NOTE = [
  "blowjob", "jerk off", "jerking off", "wank", "horny", "sexy", "whore", "harlot", "pimp", "pimps", "slut", "porn",
  "kinky", "fetish", "bondage", "orgasm", "erection", "bugger", "molest", "molested", "dildo", "clit", "camgirl",
  "fuck off", "fuck up", "fucked up", "fuckup", "fuckhead", "shithead", "shitter", "shitless", "bullshit", "bitchery",
  "bitchiness", "prickteaser", "faggot", "spic", "negro", "wog", "polack", "gyp", "mongoloid", "retard", "retarded",
  "rape", "raped", "raping", "hooker", "stripper", "dyke", "fag", "homo",
];
// Ordinary K-8 words (no dictionary text was read to pick them).
const K8 = (
  "about after again animal apple baby ball bank bark bat bear bed big bird black blue boat book box boy bread brother " +
  "brown bug bus cake call car cat chair child city clean climb clock cloud coat cold color cook cow cry cup cut dance " +
  "dark day dig dish dog doll door draw dream dress drink drop duck egg eye face fair fall family farm fast father feel " +
  "fish flag flower fly food foot friend fun game garden gift girl give good green grow hand happy hat help hide hill " +
  "home hot house hug hungry jump kind kiss kite lamp leaf light line lion little long look love man milk money moon " +
  "mother mouse music nest night nose nut old open pan park party pick pig pink plant play pull push queen rabbit rain " +
  "read red ride ring road room run sad sand school sea seed sheep shell ship shoe shop show sing sister sit sky sleep " +
  "small smile sock song spoon star stick stone store sun swim table tail talk tall teacher tooth top toy train tree " +
  "truck walk wall want warm wash watch water wet wind window wing wish wood work yard yellow young zoo " +
  "balance brave bright chalk character compare fiction gather habit honest journey orbit weed planet desert ocean " +
  "island river mountain forest volcano weather season energy force magnet machine engine bridge castle knight " +
  "dragon giant wizard treasure pirate rocket robot detective mystery shadow whisper thunder lightning rainbow " +
  "analyze ancient argument brief circumstance climate colony community conflict consequence constitution culture " +
  "debate democracy determine environment equation estimate evidence evaluate explain factor fossil function " +
  "government hypothesis identify immigrant independent influence interpret justice liberty migrate monarchy " +
  "narrator nation observe opinion perspective photosynthesis predict process protest region resource revolution " +
  "satire summarize symbol theory tradition variable volume adolescent ratio fraction decimal percent angle " +
  "triangle perimeter area graph data average multiply divide subtract addition molecule atom cell organism " +
  "ecosystem habitat predator prey adaptation evolution gravity friction velocity acceleration mass density " +
  "temperature pressure circuit current voltage element compound mixture solution reaction metaphor simile " +
  "alliteration onomatopoeia hyperbole idiom theme plot setting conflict climax resolution protagonist " +
  "antagonist dialogue stanza rhyme verse poem novel biography autobiography essay paragraph sentence noun verb " +
  "adjective adverb pronoun preposition conjunction prefix suffix synonym antonym homophone vocabulary"
).split(" ");

describe("child-safety filter on the shipped dictionary", () => {
  beforeAll(() => installAppOrigin());

  it("K-8 regression: no leaked or ordinary word's note shows an unsafe sense or example; explicit words give no note", async () => {
    const list = [...new Set([...LEAKED_SENSES, ...K8])];
    expect(new Set(K8).size).toBeGreaterThanOrEqual(300);
    const hits: string[] = [];
    let noted = 0;
    for (const w of list) {
      const got = await noteFor(w);
      if (!got?.note) continue;
      noted++;
      hits.push(...noteHits(got.note, got.exact).map((h) => `${w} -> ${h}`));
    }
    expect(hits).toEqual([]);
    expect(noted).toBeGreaterThan(300);
    const noted2: string[] = [];
    for (const w of NO_NOTE) {
      const got = await noteFor(w);
      expect(got, `${w}: the detector fires`).toBeDefined();
      if (got!.note !== null) noted2.push(w);
    }
    expect(noted2).toEqual([]);
  }, 60_000);

  it("the leaked words keep their ordinary senses, without the unsafe ones", async () => {
    const note = async (w: string) => (await noteFor(w))!.note ?? "";
    for (const w of ["naughty", "hugging", "kissing", "pet", "neck", "trip", "user", "frog", "cracker", "climax", "tart",
      "spicy", "juicy", "lush", "steamy", "teasing", "chase", "cruise", "wander", "affair", "assault", "stud", "erect",
      "dose", "sex", "drug", "colored", "adult", "ruin", "intact", "button", "turn", "deal", "mate", "male", "female"]) {
      expect(await note(w), w).not.toBe("");
    }
    expect(await note("naughty")).not.toMatch(/sexual|impropriety|blue movie/i);
    expect(await note("hugging")).not.toMatch(/foreplay|genital/i);
    expect(await note("frog")).not.toMatch(/French/);
    expect(await note("cracker")).not.toMatch(/poor White/i);
    expect(await note("trip")).not.toMatch(/drugs|hallucinat|acid trip|stoned/i);
    for (const w of ["user", "pusher", "nickel", "snort", "huff", "bummer"]) expect(await note(w), w).not.toMatch(/drug|cocaine|hallucinogen/i);
    expect(await note("drug")).toMatch(/a substance that is used as a medicine or narcotic/);
    expect(await note("drug")).not.toMatch(/recreational|kidnapped/);
    expect(await note("sex")).toMatch(/either of the two categories \(male or female\)/);
    expect(await note("sex")).not.toMatch(/intercourse|back seat|sexual/i);
    expect(await note("mongoloid")).toBe("");
  });

  it("whole-dictionary sweep: every sense and example the filter keeps passes the broad check, and the removal counts are pinned", async () => {
    const meta = await (await fetch("/dictionary/meta.json")).json() as { shardKeys: string[] };
    const shards = await Promise.all(meta.shardKeys.map(async (k) => (await (await fetch(`/dictionary/${k}.json`)).json()) as Shard));
    const heads = shards.flatMap((s) => Object.keys(s));
    let senses = 0, removed = 0, examplesDropped = 0;
    const kept: string[] = [];
    for (const shard of shards) for (const [h, rows] of Object.entries(shard)) for (const [, pos, def, ex] of rows) {
      senses++;
      if (!childSafeSense(h, def)) { removed++; continue; }
      const showEx = ex !== "" && childSafeExample(h, ex);
      if (ex !== "" && !showEx) examplesDropped++;
      const hit = broadHit(h, def, "definition") ?? (showEx ? broadHit(h, ex, "example") : null);
      if (hit) kept.push(`${h} (${pos}) [${hit}]`);
    }
    // Every sense the filter keeps, in any position (not only the ones the caps let through).
    expect(kept).toEqual([]);
    // What a student is shown: each headword typed as itself, through lookupWord and selectSenses.
    const shown: string[] = [];
    let withNote = 0, filteredToNothing = 0;
    for (const h of heads) {
      const entries = await lookupWord(h);
      if (selectSenses(entries, h, false).length === 0) continue;
      withNote++;
      const picked = selectSenses(entries, h);
      if (picked.length === 0) filteredToNothing++;
      for (const p of picked) for (const s of p.senses) {
        const hit = broadHit(p.entry.headword, s.definition, "definition") ?? (s.example ? broadHit(p.entry.headword, s.example, "example") : null);
        if (hit) shown.push(`${h} -> ${p.entry.headword} [${hit}]`);
      }
    }
    expect(shown).toEqual([]);
    // Pinned (docs/BENCHMARKS.md lever 18): a change to the filter or the data shows here. The filter
    // before 2026-11-12 removed 681 senses and 29 examples and left 383 headwords with no note, and the
    // shown note of 1,124 headwords matched BROAD.
    expect({ headwords: heads.length, senses, removed, examplesDropped, withNote, filteredToNothing }).toEqual({
      headwords: 127_311, senses: 185_129, removed: 1_881, examplesDropped: 207, withNote: 127_109, filteredToNothing: 1_156,
    });
  }, 300_000);
});
