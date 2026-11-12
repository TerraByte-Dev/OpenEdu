import { describe, it, expect, vi } from "vitest";
import {
  askedWord, dictionaryNote, lookupDictionaryNote, selectSenses, withDictionaryNote, childSafeSense, childSafeExample, blockedWord,
  contextSentences, scoringSentence,
  DICTIONARY_MAX_ENTRY_TOKENS, DICTIONARY_MAX_SENSES, DICTIONARY_NOTE, DICTIONARY_SENSES_PER_HEADWORD, DICTIONARY_SENSES_PER_POS,
} from "./defineWord";
import { estTokens } from "./budget";
import type { DictionaryEntry, Pos } from "../dictionary";

// Made-up entries: nothing here is dictionary text.
const sense = (pos: Pos, i: number, form = "zorp") => ({ form, pos, definition: `made-up ${pos} sense ${i}`, example: i % 2 ? `a made-up example ${i}` : "", synonyms: [] });
const entry = (headword: string, senses: ReturnType<typeof sense>[], via: "exact" | "form" = "exact"): DictionaryEntry => ({ headword, via, senses });

describe("askedWord: fires on an explicit meaning question", () => {
  const FIRES: Array<[string, string, string?]> = [
    ["what does enormous mean?", "enormous"],
    ["What does the word tiny mean", "tiny"],
    ["what do enormous mean", "enormous"],
    ["what did 'gobble' mean", "gobble"],
    ["what's brave mean", "brave"],
    ["whats brave mean?", "brave"],
    ["What’s “brave” mean?", "brave"],
    ["what is the meaning of giggle?", "giggle"],
    ["what's the definition of reluctant", "reluctant"],
    ["What is the definition of the word peek?", "peek"],
    ["meaning of puddle", "puddle"],
    ["The meaning of puddle?", "puddle"],
    ["definition of nibble", "nibble"],
    ["define shiver", "shiver"],
    ["Define *ubiquitous*.", "ubiquitous"],
    ["can you define photosynthesis please?", "photosynthesis"],
    ["i dont know what furious means", "furious"],
    ["I don't understand what the word cleave means", "cleave"],
    ["I do not know what tacit mean", "tacit"],
    ["what does give up mean", "give up"],
    ["what does well-being mean?", "well-being"],
    ["what does look it up mean", "look it up"],
    ["hey, what does pi mean", "pi"],
    ["ok so what does vast mean", "vast"],
    ["what does o'clock mean", "o'clock"],
    ["what does life mean", "life"],
    ["what does go mean", "go"],
    ["what does ox mean?", "ox"],
    // Digits and operators elsewhere in the message do not block a word that does not touch them.
    ["I'm in 5th grade. What does benevolent mean?", "benevolent", "I'm in 5th grade."],
    ["what does century mean in 'the 21st century'", "century", "the 21st century"],
    ["what does slope mean in y=mx+b", "slope", "y=mx+b"],
    ["what does th mean in 5th", "th", "5th"],
    // Abbreviations: they fire; the note keeps only lower-case stored forms (selectSenses).
    ["what does km mean", "km"], ["what does tv mean?", "tv"], ["what does xy mean", "xy"], ["What does mx mean?", "mx"],
    // Known, partial: these title shapes still fire.
    ["Essay prompt. The meaning of courage", "courage", "Essay prompt."],
    ["Essay prompt: define courage", "courage", "Essay prompt:"],
    // A capitalised word with a sentence that uses it.
    ["What does Bank mean in 'Bank on it'?", "Bank", "Bank on it"],
    ["The poem says Frost covered the field. What does frost mean here?", "frost", "The poem says Frost covered the field."],
    // With a sentence it is about.
    ["what does bank mean in 'we sat on the bank of the river'", "bank", "we sat on the bank of the river"],
    ["What does the word bark mean in this sentence: The bark was rough.", "bark", "The bark was rough"],
    ["what does bat mean in \"the bat flew out\"?", "bat", "the bat flew out"],
    ["meaning of bank in this sentence: we sat on the bank", "bank", "we sat on the bank"],
    ["what does sacrifice mean in baseball", "sacrifice", "baseball"],
    ["what does bark mean: the bark on the tree", "bark", "the bark on the tree"],
    ["define bank here", "bank"],
    // "in English" is not another language: it asks for the meaning in plain words.
    ["what does gregarious mean in english", "gregarious", "english"],
    // The sentence before the question.
    ["My mom said my bag is light. What does light mean here?", "light", "My mom said my bag is light."],
    ["Read the sentence. The path was narrow. What does the word narrow mean in this sentence?", "narrow", "Read the sentence. The path was narrow."],
  ];
  it.each(FIRES)("%s", (text, word, context) => {
    const got = askedWord(text);
    expect(got?.word).toBe(word);
    expect(got?.context).toBe(context);
  });
});

describe("askedWord: does not fire", () => {
  const NO: string[] = [
    // Pronouns, determiners, deictics.
    "what does that mean", "what does this mean?", "what does it mean", "what do you mean?", "what do you mean by that",
    "what does it mean to be brave", "what does that word mean", "what do these words mean", "what does all that mean",
    "what does the answer mean", "what does my teacher mean", "what does your answer mean", "what does he mean",
    "I don't know what that means", "I don't know what it means", "what's that mean?", "define it",
    "define the derivative", "Define a function f", "Define your terms", "meaning of this", "what does a mean",
    // Single letters, numbers, symbols (maths).
    "what does x mean", "what does x mean in this equation", "What does n mean?", "what does 2x mean", "what does π mean",
    "What does αβ mean in the decay?", "What does ℏω mean?", "what does = mean", "what does 3/4 mean",
    // A lone function word: the lookup maps some to a letter.
    "what does is mean", "what does his mean", "what does us mean", "what does of mean",
    // Something after X that is not a context.
    "what does freedom mean to you", "what does photosynthesis mean for plants", "what does this mean for the answer",
    "what does bank mean? I am confused",
    // A name: what a poet, a character or a speaker meant (P10). Partial: see defineWord.ts.
    "What does Frost mean in the last stanza?", "What does Lincoln mean in the Gettysburg Address?", "What does Hamlet mean?",
    "what does Atticus mean in chapter 3",
    // The capital-letter guard also refuses title case and all caps (a known cost, disclosed in lever 18).
    "Define Photosynthesis", "What Does Brave Mean?", "WHAT DOES BRAVE MEAN",
    // Maths: X touches an operator or a digit somewhere in the message.
    "what does mx mean in y=mx+b", "what does dy mean in dy/dx", "what does sin mean in sin(2x)", "what does e mean in e^x",
    "what does ab mean in 3ab", "what does x2 mean",
    // A title or an assignment (partial: "Essay prompt. The meaning of courage" and "Essay prompt: define
    // courage" still fire; lever 18 lists them).
    "Essay prompt: the meaning of courage", "Title: definition of freedom", "Define justice in your own words.",
    // Another language's word: the English entry would be the wrong word (2026-11-12).
    "what does chat mean in french", "what does gato mean in spanish?", "What does amor mean in Latin?",
    "what does hola mean in spanish class", "what is the meaning of chat in French", "define gato in spanish",
    "what does chat mean in the French language", "what does arigato mean in japanese",
    // Not a meaning question, or a "what is a X" question (a later arm).
    "what is a bank", "What is photosynthesis?", "what is the meaning of life and why", "what is the meaning of life?", "meaning of life", "what does give it mean", "Show me the full worked answer.",
    "I think it's B.", "Is it 10?", "Which one is right?", "ok thanks", "It means the same thing.",
    "Give me a hint.", "Walk me through it.", "what does the mean, median and mode tell us about the data set",
    "What is the mean of 3, 5 and 7?", "I mean, what does she want?", "",
  ];
  it.each(NO)("%j", (text) => {
    expect(askedWord(text)).toBeNull();
  });
});

describe("selectSenses: caps", () => {
  it("leaves out a one-letter form always, and a two-letter form only next to an exact entry", () => {
    const z = entry("z", [sense("n", 0, "z")], "form");
    const zz = entry("zz", [sense("n", 1, "zz")], "form");
    expect(selectSenses([z, entry("zorp", [sense("n", 2)], "form")]).map((p) => p.entry.headword)).toEqual(["zorp"]);
    expect(selectSenses([zz]).map((p) => p.entry.headword)).toEqual(["zz"]);
    expect(selectSenses([entry("zzs", [sense("n", 3, "zzs")]), zz]).map((p) => p.entry.headword)).toEqual(["zzs"]);
    expect(dictionaryNote("zs", [z])).toBeNull();
  });

  it("child-safety filter: drops a labelled sense, a drug sense on a non-drug word, an unsafe example, and blocked words", () => {
    const zorp = entry("zorp", [
      { ...sense("n", 0), definition: "vulgar slang for a made-up thing" },
      { ...sense("n", 1), definition: "a made-up powder; a street name for nothing" },
      { ...sense("n", 2), definition: "slang for marijuana" },
      { ...sense("v", 3), definition: "to make up", example: "a made-up example with a sex act in it" },
      { ...sense("v", 4), definition: "to make up again", example: "a fine example" },
    ]);
    const shown = selectSenses([zorp], "zorp")[0].senses;
    expect(shown.map((s) => s.definition)).toEqual(["to make up", "to make up again"]);
    expect(shown.map((s) => s.example)).toEqual(["", "a fine example"]);
    // A drug word keeps its own entry; the filter can be turned off for the item check.
    expect(selectSenses([entry("cocaine", [{ ...sense("n", 0, "cocaine"), definition: "a drug like cocaine" }])], "cocaine")[0].senses).toHaveLength(1);
    expect(selectSenses([zorp], "zorp", false)[0].senses).toHaveLength(5);
    // A blocked word gives no note, typed or reached as a form.
    expect(dictionaryNote("shit", [entry("shit", [sense("n", 0, "shit")])])).toBeNull();
    expect(dictionaryNote("shitting", [entry("shit", [sense("n", 0, "shit")], "form")])).toBeNull();
    // Bare labels need a label noun: "chaste" and "censor"-like definitions keep their sense.
    expect(selectSenses([entry("zorp", [{ ...sense("a", 0), definition: "not obscene or vulgar in thought" }])], "zorp")).toHaveLength(1);
  });

  it("child-safety filter, widened 2026-11-12: neutral biology and identity wording, the allow-list, drug examples, profanity stems", () => {
    // "sexual" removes a sense unless it is one of the neutral phrases.
    expect(childSafeSense("zorp", "a made-up cell used in sexual reproduction")).toBe(true);
    expect(childSafeSense("zorp", "a person having a sexual orientation to persons of the opposite sex")).toBe(true);
    expect(childSafeSense("zorp", "a made-up feeling of sexual desire")).toBe(false);
    expect(childSafeSense("zorp", "an adult who is sexually attracted to children")).toBe(false);
    expect(childSafeSense("zorp", "suggestive of sexual impropriety")).toBe(false);
    // Genital wording and the bare descent gloss pass only on the allow-list.
    expect(childSafeSense("zorp", "a made-up part of the genitals")).toBe(false);
    expect(childSafeSense("urethra", "a made-up part of the genitals")).toBe(true);
    expect(childSafeSense("zorp", "a person of Zorpish descent")).toBe(false);
    expect(childSafeSense("chicano", "a person of Zorpish descent")).toBe(true);
    // Drug use in a definition or example, except on a drug's own entry; a bare "narcotic" in an
    // example is the adjective ("a narcotic speech"); "medicine or narcotic" defines "drug".
    expect(childSafeSense("zorp", "a person who takes drugs")).toBe(false);
    expect(childSafeSense("drug", "a substance that is used as a medicine or narcotic")).toBe(true);
    expect(childSafeSense("zorp", "a narcotic made up for this test")).toBe(false);
    expect(childSafeExample("zorp", "a narcotic speech")).toBe(true);
    expect(childSafeExample("zorp", "he snorted cocaine")).toBe(false);
    expect(childSafeExample("cocaine", "he snorted cocaine")).toBe(true);
    // Profanity by stem, with the innocent words that contain one.
    for (const w of ["fuck off", "bullshit", "shithead", "bitchiness", "jerk off", "horny", "retarded", "faggot"]) expect(blockedWord(w), w).toBe(true);
    for (const w of ["saltwater", "wristwatch", "swank", "wankel engine", "cushitic", "shittim", "clitic", "retardant", "horny toad", "spic-and-span"]) expect(blockedWord(w), w).toBe(false);
    expect(childSafeSense("zorp", "an agent that retards the clotting of blood")).toBe(true);
    expect(childSafeExample("zorp", "feeling horny")).toBe(false);
  });

  it("drops capitalised stored forms when the student typed lower case, and keeps them when not", () => {
    const tv = entry("tv", [sense("n", 0, "tv"), sense("n", 1, "TV")]);
    expect(selectSenses([tv], "tv")[0].senses.map((s) => s.form)).toEqual(["tv"]);
    expect(selectSenses([tv], "TV")[0].senses.map((s) => s.form)).toEqual(["tv", "TV"]);
    expect(dictionaryNote("mx", [entry("mx", [sense("n", 0, "Mx")])])).toBeNull();
    expect(dictionaryNote("ma", [entry("ma", [sense("n", 0, "ma"), sense("n", 1, "MA"), sense("n", 2, "mA")])])).toContain("1. ma (noun)");
  });

  it("keeps stored order, at most SENSES_PER_POS per part of speech and SENSES_PER_HEADWORD per headword", () => {
    const senses = [0, 1, 2, 3, 4].map((i) => sense("n", i)).concat([0, 1, 2, 3].map((i) => sense("v", i)), [sense("a", 0)]);
    const [picked] = selectSenses([entry("zorp", senses)]);
    expect(picked.senses.map((s) => `${s.pos}${s.definition.slice(-1)}`)).toEqual(["n0", "n1", "n2", "v0", "v1", "v2"].slice(0, DICTIONARY_SENSES_PER_HEADWORD));
    expect(DICTIONARY_SENSES_PER_POS).toBe(3);
  });
  it("keeps lookupWord's headword order and stops at MAX_SENSES in all", () => {
    const many = (h: string) => entry(h, [0, 1, 2].map((i) => sense("n", i, h)).concat([0, 1, 2].map((i) => sense("v", i, h))));
    const picked = selectSenses([many("aaa"), many("bbb"), many("ccc")]);
    expect(picked.map((p) => p.entry.headword)).toEqual(["aaa", "bbb"]);
    expect(picked.reduce((k, p) => k + p.senses.length, 0)).toBe(DICTIONARY_MAX_SENSES);
  });
});

describe("dictionaryNote", () => {
  it("is null with no entries, so the turn is unchanged", () => {
    expect(dictionaryNote("zorp", [])).toBeNull();
    expect(dictionaryNote("zorp", [entry("zorp", [])])).toBeNull();
  });

  it("renders the entry, then the note naming the word", () => {
    const note = dictionaryNote("zorped", [entry("zorp", [sense("v", 1), sense("n", 0)], "form")])!;
    expect(note).toBe(`<dictionary_entry source="Open English WordNet">
"zorped" is a form of "zorp".
1. zorp (verb): made-up v sense 1. Example: "a made-up example 1"
2. zorp (noun): made-up n sense 0
</dictionary_entry>
${DICTIONARY_NOTE.replace("{word}", "zorped")}`);
    expect(note).not.toContain("\r");
  });

  it("cuts senses from the end until the entry fits the token cap, keeping at least one", () => {
    const long = (i: number) => ({ ...sense("n", i), definition: `${"long made-up text ".repeat(20)}${i}` });
    const note = dictionaryNote("zorp", [entry("zorp", [long(0), long(1), long(2)]), entry("zorps", [long(3), long(4), long(5)])])!;
    const block = note.slice(0, note.indexOf("<tutor_note>"));
    expect(estTokens(block.trim())).toBeLessThanOrEqual(DICTIONARY_MAX_ENTRY_TOKENS);
    expect(block).toContain("1. zorp");
    const huge = { ...sense("n", 0), definition: "x".repeat(4000) };
    expect(dictionaryNote("zorp", [entry("zorp", [huge, sense("n", 1)])])).toContain("1. zorp");
  });

  it("puts the word into the note literally, even with $ in it", () => {
    expect(dictionaryNote("a$&b", [entry("zorp", [sense("n", 0)])])).toContain('asked what "a$&b" means');
  });

  it("appends after the student's text", () => {
    expect(withDictionaryNote("what does zorp mean", "NOTE")).toBe("what does zorp mean\n\nNOTE");
  });
});

describe("lookupDictionaryNote: a lookup never fails or stalls the turn", () => {
  it("returns the note when the lookup finds the word", async () => {
    const note = await lookupDictionaryNote("zorp", async () => [entry("zorp", [sense("n", 0)])]);
    expect(note).toContain("1. zorp (noun)");
  });
  it("returns null when the word is not found", async () => {
    expect(await lookupDictionaryNote("zorp", async () => [])).toBeNull();
  });
  it("returns null when the lookup throws", async () => {
    expect(await lookupDictionaryNote("zorp", async () => { throw new Error("bundled files unreadable"); })).toBeNull();
  });
  it("returns null at once when the student stops the turn during a slow lookup", async () => {
    const turn = new AbortController();
    const p = lookupDictionaryNote("zorp", () => new Promise<DictionaryEntry[]>(() => {}), 60_000, turn.signal);
    turn.abort();
    expect(await p).toBeNull();
  });

  it("returns null at the deadline when the lookup hangs", async () => {
    vi.useFakeTimers();
    try {
      const p = lookupDictionaryNote("zorp", () => new Promise<DictionaryEntry[]>(() => {}), 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Lever 19: the sentence, and ranking inside selectSenses ──────────────────
const def = (pos: Pos, definition: string, example = "", form = "zorp") => ({ form, pos, definition, example, synonyms: [] });

describe("contextSentences and scoringSentence (lever 19, R3)", () => {
  const zorp = entry("zorp", [def("n", "a small boat"), def("v", "to row a boat")]);
  const lookup = (map: Record<string, string[]>) => async (w: string) => (map[w] ?? []).map((h) => entry(h, [def("n", "x")], h === w ? "exact" : "form"));

  it("splits after . ! or ? followed by a space, and at line breaks", () => {
    expect(contextSentences("I'm in 5th grade. We zorp a lot! Do you?\nNew line here")).toEqual(["I'm in 5th grade.", "We zorp a lot!", "Do you?", "New line here"]);
    expect(contextSentences("e.g. the 3.5 zorp")).toEqual(["e.g.", "the 3.5 zorp"]); // the rule as written: decimals stay whole
  });

  it("is the last sentence that contains the word as typed, any case, as a whole word", async () => {
    const none = lookup({});
    expect(await scoringSentence("zorp", "We had a Zorp. The zorp sank.", [zorp], none)).toBe("The zorp sank.");
    expect(await scoringSentence("zorp", "The zorp sank. It was sad.", [zorp], none)).toBe("The zorp sank.");
    expect(await scoringSentence("zorp", "the zorps sank", [zorp], none)).toBeNull();
    expect(await scoringSentence("zorp", "zorping is fun", [zorp], none)).toBeNull();
  });

  it("is none when no sentence contains the word: other text before the question, or a pointer to the text", async () => {
    const none = lookup({});
    expect(await scoringSentence("zorp", "I'm in 5th grade.", [zorp], none)).toBeNull();
    expect(await scoringSentence("zorp", "the last stanza", [zorp], none)).toBeNull();
    expect(await scoringSentence("zorp", undefined, [zorp], none)).toBeNull();
  });

  it("counts a form lookupWord resolves to the same headword, and takes the later sentence", async () => {
    const forms = lookup({ zorped: ["zorp"], zorps: ["zorp"], went: ["go"] });
    expect(await scoringSentence("zorp", "They zorped home.", [zorp], forms)).toBe("They zorped home.");
    expect(await scoringSentence("zorp", "A zorp. They zorped home.", [zorp], forms)).toBe("They zorped home.");
    expect(await scoringSentence("zorp", "They zorped home. A zorp.", [zorp], forms)).toBe("A zorp.");
    expect(await scoringSentence("zorp", "They went home.", [zorp], forms)).toBeNull();
    expect(await scoringSentence("zorped", "the zorp sank", [zorp], lookup({ zorp: ["zorp"] }))).toBe("the zorp sank");
  });

  it("matches a typed phrase as the same number of consecutive words", async () => {
    const z = entry("zorp out", [def("v", "x")]);
    const forms = lookup({ "zorped out": ["zorp out"] });
    expect(await scoringSentence("zorp out", "can you zorp out the answer", [z], forms)).toBe("can you zorp out the answer");
    expect(await scoringSentence("zorp out", "she zorped out the answer", [z], forms)).toBe("she zorped out the answer");
    expect(await scoringSentence("zorp out", "zorp it out", [z], forms)).toBeNull();
  });

  it("does not look anything up when the last sentence has the word as typed, and a failed lookup is no match", async () => {
    const seen: string[] = [];
    const spy = async (w: string) => { seen.push(w); return []; };
    expect(await scoringSentence("zorp", "They zorped. The zorp sank.", [zorp], spy)).toBe("The zorp sank.");
    expect(seen).toEqual([]);
    expect(await scoringSentence("zorp", "The zorp sank. They zorped.", [zorp], async () => { throw new Error("x"); })).toBe("The zorp sank.");
  });
});

describe("selectSenses with a sentence (lever 19)", () => {
  const senses = [
    def("n", "a box for storing clothes"), def("n", "the main stem of a tree"), def("n", "the body of a person"),
    def("n", "the long nose of an elephant", "the elephant raised its zorp"), def("v", "to pack in a box"),
  ];
  const z = entry("zorp", senses);

  it("ranks before the caps: a fourth noun sense the sentence uses is shown first", () => {
    const stored = selectSenses([z], "zorp");
    expect(stored[0].senses.map((s) => s.definition)).toEqual([senses[0], senses[1], senses[2], senses[4]].map((s) => s.definition));
    const ranked = selectSenses([z], "zorp", true, "the elephant lifted water with its zorp");
    expect(ranked[0].senses.map((s) => s.definition)).toEqual([senses[3], senses[0], senses[1], senses[4]].map((s) => s.definition));
    expect(ranked[0].senses.filter((s) => s.pos === "n")).toHaveLength(DICTIONARY_SENSES_PER_POS);
  });

  it("is lever 18's selection, exactly, with no sentence or no overlap", () => {
    expect(selectSenses([z], "zorp", true, null)).toEqual(selectSenses([z], "zorp"));
    expect(selectSenses([z], "zorp", true, "nothing overlaps here")).toEqual(selectSenses([z], "zorp"));
    expect(dictionaryNote("zorp", [z], "nothing overlaps here")).toBe(dictionaryNote("zorp", [z]));
  });

  it("applies the child-safety filter after ranking: a removed sense never surfaces, however well it matches", () => {
    const unsafe = entry("zorp", [def("n", "a small boat"), def("n", "obscene slang for a lewd act on a boat", "a lewd zorp on a boat")]);
    for (const sentence of ["obscene slang for a lewd act on a boat", "a lewd zorp on a boat"]) {
      const shown = selectSenses([unsafe], "zorp", true, sentence).flatMap((p) => p.senses.map((s) => s.definition));
      expect(shown).toEqual(["a small boat"]);
    }
    expect(selectSenses([entry("shit", [def("n", "a boat")])], "shit", true, "a boat")).toEqual([]);
  });

  it("keeps lookupWord's headword order and the total cap", () => {
    const many = (h: string) => entry(h, [0, 1, 2].map((i) => def("n", `${h} plain ${i}`, "", h)).concat([def("v", `${h} river water`, "", h)]));
    const picked = selectSenses([many("aaa"), many("bbb"), many("ccc")], "aaa", true, "the river water");
    expect(picked.map((p) => p.entry.headword)).toEqual(["aaa", "bbb"]);
    expect(picked[0].senses[0].definition).toBe("aaa river water");
    expect(picked.reduce((k, p) => k + p.senses.length, 0)).toBe(DICTIONARY_MAX_SENSES);
  });
});

describe("lookupDictionaryNote with the student's context (lever 19)", () => {
  const z = entry("zorp", [def("n", "a box for clothes"), def("n", "a long nose of an elephant")]);
  it("ranks by the context's sentence that contains the word; with no context the note is lever 18's", async () => {
    const plain = await lookupDictionaryNote("zorp", async () => [z]);
    expect(plain).toBe(dictionaryNote("zorp", [z]));
    const ranked = await lookupDictionaryNote("zorp", async () => [z], undefined, undefined, "the elephant lifted its zorp");
    expect(ranked).toBe(dictionaryNote("zorp", [z], "the elephant lifted its zorp"));
    expect(ranked).not.toBe(plain);
    expect(await lookupDictionaryNote("zorp", async (w) => (w === "zorp" ? [z] : []), undefined, undefined, "I'm in 5th grade. My elephant is big.")).toBe(plain);
  });

  it("keeps the stored order when finding the sentence outlasts the deadline", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const lookup = () => (n++ === 0 ? Promise.resolve([z]) : new Promise<DictionaryEntry[]>(() => {}));
      const p = lookupDictionaryNote("zorp", lookup, 50, undefined, "an elephant nose. They zorped.");
      await vi.advanceTimersByTimeAsync(60);
      expect(await p).toBe(dictionaryNote("zorp", [z]));
    } finally {
      vi.useRealTimers();
    }
  });
});
