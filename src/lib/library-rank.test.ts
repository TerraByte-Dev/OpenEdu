import { describe, it, expect } from "vitest";
import { words, wordLength, tokenize, normalizePhrase, matchResourcesScored } from "./library-rank";
import type { LibraryEntry } from "../types";

// The splitter every lexical matcher in the app goes through: library ranking (tokenize /
// normalizePhrase), the grounding gate (ground.ts contentWords) and dataset lookup.

describe("words — non-Latin scripts are words, not separators", () => {
  it("Hindi: combining vowel signs and viramas stay inside the word", () => {
    // "हिन्दी" is ह ि न ् द ी — four of its six code points are combining marks. A split on
    // [^\p{L}\p{N}] would return "ह", "न", "द".
    expect(words("हिन्दी में प्रकाश संश्लेषण क्या है?")).toEqual(["हिन्दी", "में", "प्रकाश", "संश्लेषण", "क्या", "है"]);
  });

  it("Bengali and Thai keep their marks too", () => {
    expect(words("সালোকসংশ্লেষণ কী?")).toEqual(["সালোকসংশ্লেষণ", "কী"]);
    expect(words("น้ำ คือ อะไร")).toEqual(["น้ำ", "คือ", "อะไร"]);
  });

  it("Amharic (Ethiopic): syllables are letters; Ethiopic punctuation separates", () => {
    expect(words("ፎቶሲንተሲስ ምንድን ነው?")).toEqual(["ፎቶሲንተሲስ", "ምንድን", "ነው"]);
    expect(words("ውሃ፣ አየር።")).toEqual(["ውሃ", "አየር"]);
  });

  it("Arabic: letters kept, Arabic question mark and comma separate, diacritics untouched", () => {
    expect(words("ما هو التمثيل الضوئي؟")).toEqual(["ما", "هو", "التمثيل", "الضوئي"]);
    expect(words("ماءٌ، هواء")).toEqual(["ماءٌ", "هواء"]);
  });

  it("native decimal digits are digits", () => {
    expect(words("कक्षा १० और ٣ ")).toEqual(["कक्षा", "१०", "और", "٣"]);
  });

  it("is NFC-normalised, so a decomposed and a precomposed spelling are one word", () => {
    // Devanagari "क़" has a precomposed code point (U+0958) and a decomposed form (क + nukta).
    expect(words("\u0958")).toEqual(words("\u0915\u093C"));
  });
});

describe("words — accents fold on Latin letters only", () => {
  it("Spanish: accented and unaccented spellings meet", () => {
    expect(words("¿Qué es la energía?")).toEqual(["que", "es", "la", "energia"]);
    expect(words("energía")).toEqual(words("energia"));
    expect(words("Año, niño, Bogotá, Perú")).toEqual(["ano", "nino", "bogota", "peru"]);
  });

  it("precomposed and combining-mark spellings of a Latin word are identical", () => {
    expect(words("energ\u00EDa")).toEqual(words("energi\u0301a"));
  });

  it("Vietnamese stacked diacritics all fold (a Latin-script language)", () => {
    expect(words("Quang hợp là gì")).toEqual(["quang", "hop", "la", "gi"]);
  });

  it("never strips a mark from a non-Latin letter", () => {
    expect(words("हिन्दी")[0].normalize("NFD")).toContain("\u093F"); // vowel sign i survives
    expect(words("Ελληνικά")).toEqual(["ελληνικά"]); // Greek tonos is spelling, not decoration
  });

  it("lowercases with the locale-free toLowerCase", () => {
    // Turkish dotted capital I lowercases to i + combining dot above; the dot is a Latin mark and folds.
    expect(words("İSTANBUL")).toEqual(["istanbul"]);
  });
});

describe("words — mixed script, notation and emoji", () => {
  it("never puts Latin and non-Latin letters in one token", () => {
    expect(words("DNAका structure")).toEqual(["dna", "का", "structure"]);
    expect(words("photosynthesis प्रकाश संश्लेषण")).toEqual(["photosynthesis", "प्रकाश", "संश्लेषण"]);
  });

  it("keeps math notation splitting exactly where ASCII-only splitting did", () => {
    // The English library writes trig, logs and chemistry this way. These were ["sin"], ["log", "x"],
    // ["co"], ["2tan"] before Unicode, and must still be.
    expect(words("sinθ")).toEqual(["sin", "θ"]);
    expect(words("logₐ(x)")).toEqual(["log", "x"]);
    expect(words("CO₂ and m²")).toEqual(["co", "and", "m"]);
    expect(words("2tanθ")).toEqual(["2tan", "θ"]);
    expect(words("2πr")).toEqual(["2", "π", "r"]);
  });

  it("emoji are separators, including variation selectors and skin tones", () => {
    expect(words("🌋 volcano 🔥🔥")).toEqual(["volcano"]);
    expect(tokenize("❤️ 👍🏽 👨‍👩‍👧")).toEqual([]);
    expect(tokenize("1️⃣ step")).toEqual(["step"]);
  });

  it("Spacing Modifier Letters that are not Latin-script still separate", () => {
    // U+02B9 (modifier prime) and U+02D0 (IPA length mark) are Lm with Script=Common, so only the
    // explicit U+02B0-U+02FF range in NOT_WORD keeps them from becoming one-character "words".
    expect(words("fʹ(x) = 2x")).toEqual(["f", "x", "2x"]);
    expect(words("a: aː")).toEqual(["a", "a"]);
  });

  it("native digits never glue onto a non-Latin word", () => {
    expect(words("कक्षा१०")).toEqual(["कक्षा", "१०"]);
    expect(words("الصف٣")).toEqual(["الصف", "٣"]);
  });
});

describe("words — zero-width joiners are part of the word", () => {
  // Built from code points: the joiners are invisible, and a literal one in source is unreviewable.
  const ZWNJ = String.fromCodePoint(0x200c);
  const ZWJ = String.fromCodePoint(0x200d);

  it("Sinhala Sri (ZWJ conjunct) stays one word and survives the length filter", () => {
    expect(words(`ශ්${ZWJ}රී ලංකාව`)).toEqual(["ශ්රී", "ලංකාව"]);
    expect(tokenize(`ශ්${ZWJ}රී`)).toEqual(["ශ්රී"]);
  });

  it("a Devanagari ZWNJ conjunct is the plain conjunct, not two dropped fragments", () => {
    expect(tokenize(`क्${ZWNJ}ष`)).toEqual(tokenize("क्ष"));
    expect(tokenize("क्ष")).toEqual(["क्ष"]);
  });

  it("Persian ZWNJ words are one token, matching the unjoined spelling", () => {
    expect(words(`می${ZWNJ}خواهم`)).toEqual(words("میخواهم"));
    expect(words(`می${ZWNJ}خواهم`)).toHaveLength(1);
  });

  it("emoji ZWJ sequences are still separators", () => {
    expect(words(`👨${ZWJ}👩${ZWJ}👧 family`)).toEqual(["family"]);
  });
});

describe("wordLength — the >= 2 filter counts letters, not UTF-16 units", () => {
  it("one akshara (consonant + vowel sign) is one character", () => {
    expect("का".length).toBe(2); // why .length was wrong
    expect(wordLength("का")).toBe(1);
    expect(wordLength("है")).toBe(1);
    expect(wordLength("में")).toBe(1);
  });

  it("a two-consonant Hindi word is two characters, matras or not", () => {
    expect(wordLength("घर")).toBe(2);
    expect(wordLength("पानी")).toBe(2);
  });

  it("is .length for ASCII", () => {
    expect(wordLength("mitochondria")).toBe("mitochondria".length);
  });

  it("drops single-akshara particles and keeps two-letter words, in the real tokenizer", () => {
    expect(tokenize("पानी का घर है")).toEqual(["पानी", "घर"]);
  });
});

describe("tokenize / normalizePhrase — apostrophes and elision", () => {
  it("English apostrophes still elide, exactly as before", () => {
    expect(tokenize("Boyle's law")).toEqual(tokenize("boyles law"));
    expect(tokenize("boyle’s law")).toEqual(["boyle", "law"]);
    expect(normalizePhrase("Kirchhoff's Laws")).toBe("kirchhoffs laws");
  });

  it("French elided articles drop, so l'énergie reaches énergie", () => {
    expect(tokenize("l'énergie")).toEqual(tokenize("énergie"));
    expect(tokenize("Qu'est-ce que l'énergie ?")).toEqual(["est", "ce", "que", "energie"]);
    expect(tokenize("J’ai froid")).toEqual(["ai", "froid"]);
    expect(normalizePhrase("L'Été")).toBe("ete");
  });

  it("an apostrophe inside an English word is not a clitic", () => {
    expect(tokenize("don't")).toEqual(["dont"]);
    expect(tokenize("it's")).toEqual(["its"]);
  });
});

describe("tokenize — English output is unchanged", () => {
  // The pre-Unicode implementation, kept here ONLY as an oracle: production no longer calls it.
  const OLD_STOP = new Set(["the", "a", "an", "of", "for", "to", "in", "on", "is", "are", "what", "whats", "show", "me", "my",
    "tell", "about", "give", "list", "and", "or", "how", "do", "i", "you", "can", "with", "this", "that"]);
  const oldFold = (t: string) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  const oldTokenize = (s: string) =>
    s.toLowerCase().replace(/['‘’ʼ]/g, "").split(/[^a-z0-9]+/).map(oldFold).filter((t) => t.length >= 2 && !OLD_STOP.has(t));
  const oldPhrase = (s: string) => s.toLowerCase().replace(/['‘’ʼ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  it("matches the old tokenizer on 5,000 random printable-ASCII strings", () => {
    // Seeded, so a failure reproduces. Biased toward letters, spaces and apostrophes, which is where
    // the elision and clitic rules live.
    let seed = 0x5eed;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = "abcdeijlmnqstuxyzABCDLST0129    ''’-_.,?!()/";
    for (let n = 0; n < 5000; n++) {
      let s = "";
      const len = 1 + Math.floor(rand() * 30);
      for (let i = 0; i < len; i++) s += rand() < 0.15 ? String.fromCharCode(32 + Math.floor(rand() * 95)) : alphabet[Math.floor(rand() * alphabet.length)];
      // A word-initial c/d/j/l/m/n/s/t + apostrophe + letter is French elision by design (see
      // ELIDED_CLITIC); no English word has that shape, so random strings that do are excluded.
      if (/(^|[^a-z0-9])(?:[cdjlmnst]|qu)['‘’ʼ][a-z]/i.test(s)) continue;
      expect(tokenize(s), JSON.stringify(s)).toEqual(oldTokenize(s));
      expect(normalizePhrase(s), JSON.stringify(s)).toBe(oldPhrase(s));
    }
  });
});

describe("matchResourcesScored — a Spanish query without accents reaches an accented card", () => {
  const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
    id: "x", title: "", path: "x.md", aliases: [], tags: [], subject: "", summary: "", ...over,
  });
  const manifest = [
    entry({ id: "es/dias", title: "Los días de la semana", aliases: ["días", "semana"], tags: ["spanish"] }),
    entry({ id: "hi/water", title: "पानी का चक्र", aliases: ["जल चक्र"], tags: ["hindi"] }),
    entry({ id: "en/cell", title: "Animal and plant cells", aliases: ["cell"], tags: ["biology"] }),
  ];

  it("dias de la semana -> the días card", () => {
    expect(matchResourcesScored("dias de la semana", manifest)[0]?.entry.id).toBe("es/dias");
  });

  it("a Hindi query reaches a Hindi card", () => {
    expect(matchResourcesScored("पानी का चक्र क्या है", manifest)[0]?.entry.id).toBe("hi/water");
  });

  it("an unknown non-Latin frame does not dilute an English query", () => {
    // "क्या है" is in no card, so it is dropped before scoring; the score is the bare query's.
    const bare = matchResourcesScored("animal and plant cells", manifest)[0];
    for (const q of ["animal and plant cells क्या है", "ما هو animal and plant cells", "animal and plant cells ምንድን ነው"]) {
      const r = matchResourcesScored(q, manifest)[0];
      expect(r?.entry.id, q).toBe("en/cell");
      expect(r?.score, q).toBe(bare.score);
    }
  });

  it("a non-Latin word the corpus contains is kept, so the Hindi title still matches exactly", () => {
    // "पानी का चक्र" is the title verbatim once the unknown "क्या है" is dropped: exact (+12), not containment.
    expect(matchResourcesScored("पानी का चक्र क्या है", manifest)[0]?.score)
      .toBe(matchResourcesScored("पानी का चक्र", manifest)[0]?.score);
  });

  it("an unknown Latin word still counts against coverage", () => {
    // Only non-Latin words are dropped. "spectroscopy" is in no card and must still cost the cell card.
    const bare = matchResourcesScored("cell", manifest)[0].score;
    expect(matchResourcesScored("cell spectroscopy", manifest)[0].score).toBeLessThan(bare);
  });
});

describe("matchResourcesScored — the phrase bonus matches whole words only (#145)", () => {
  const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
    id: "x", title: "", path: "x.md", aliases: [], tags: [], subject: "", summary: "", ...over,
  });
  const ph = entry({ id: "chem/ph", title: "The pH Scale", aliases: ["ph", "acidity"], tags: ["chemistry"] });
  const para = entry({ id: "ela/paragraph", title: "Paragraph structure", aliases: ["topic sentence"], tags: ["writing"] });
  const manifest = [ph, para];
  const score = (q: string, e: LibraryEntry) => matchResourcesScored(q, manifest, 5).find((r) => r.entry.id === e.id)?.score ?? 0;

  it("an alias does not score inside a longer word", () => {
    expect(score("how do I write a good paragraph", ph)).toBe(0);
    expect(score("read the graph", ph)).toBe(0);
  });

  it("an alias still scores as a word in a longer query", () => {
    expect(score("what is the ph of lemon juice", ph)).toBeGreaterThan(0);
  });
});
