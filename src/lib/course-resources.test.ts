import { describe, it, expect } from "vitest";
import manifestJson from "../../public/library/index.json";
import { normalizeManifest, matchResources } from "./library-rank";
import { courseResources } from "./course-resources";
import { RESOURCE_TOPICS, RIGHT_CARDS, WRONG_CARDS } from "./course-resources-topics";

// The Resources tab's "recommended for this course", over the Library the app ships and syllabuses as the
// course model wrote them in TerraTutor's 2026-11-19 click test (gemma4:e2b; port of TerraTutor #249).

const manifest = normalizeManifest(manifestJson);
const titles = (topic: string, subtopics: Parameters<typeof courseResources>[1]) =>
  courseResources(topic, subtopics, manifest).map((e) => e.title);

const FRACTIONS_L1 = [
  { title: "What is a Fraction? Whole and Parts", key_concepts: [
    "Whole: The complete object or amount being divided.", "Part: A piece of the whole object or amount.",
    "Equal Parts: Parts that are exactly the same size as each other.",
    "Numerator and Denominator: The top number (numerator) tells how many parts you have; the bottom number (denominator) tells the total number of equal parts the whole is divided into.",
  ] },
  { title: "Defining Equal Parts", key_concepts: ["Whole vs. Part", "Equal Parts", "Numerator", "Denominator"] },
  { title: "Identifying the Numerator and Denominator", key_concepts: [
    "Numerator: The number of parts being considered.", "Denominator: The total number of equal parts the whole is divided into.",
    "Whole: The complete object or group being divided.", "Equal Parts: Parts that are the exact same size.",
  ] },
  { title: "Visualizing Simple Fractions (One Half and One Third)", key_concepts: [
    "Identifying the whole object being divided", "Defining an equal part",
    "Writing the fraction notation for one half (1/2) and one third (1/3)", "Matching a visual representation to its fraction notation",
  ] },
];

const CELLS_L1 = [
  { title: "What is a Cell? Defining Life and Non-Life", key_concepts: ["Definition of a cell", "The Cell Theory", "Prokaryotic cell vs. Eukaryotic cell", "Basic cell components (membrane and cytoplasm)"] },
  { title: "Introduction to Cell Theory", key_concepts: ["Definition of a cell", "The three main tenets of the Cell Theory", "Difference between prokaryotic and eukaryotic cells"] },
];

describe("courseResources: the Resources tab's cards for a course", () => {
  it("recommends nothing for a fractions course when the Library has no card about fractions", () => {
    // The old joined query kept anything above zero: Parts of Speech first, then music and physics cards.
    const joined = ["fractions", ...FRACTIONS_L1.flatMap((s) => [s.title, ...s.key_concepts])].join(" ");
    expect(matchResources(joined, manifest, 36).map((e) => e.title)).toContain("Parts of Speech");
    expect(titles("fractions", FRACTIONS_L1)).toEqual([]);
  });

  it("recommends the cards about cells for a cells course, best first, and nothing off-topic", () => {
    const shown = courseResources("cells", CELLS_L1, manifest);
    expect(shown[0]?.title).toBe("Animal vs Plant Cell");
    expect(shown.map((e) => e.subject)).toEqual(shown.map(() => "biology"));
  });

  it("drops a card that one word of a key concept names when nothing else in the course points at it", () => {
    const subtopics = [{
      title: "Cell Differentiation and Transcriptional Control",
      key_concepts: ["Chromatin Remodeling Dynamics: Analyze the mechanisms (e.g., histone modification, chromatin remodeling complexes like SWI/SNF) that control the accessibility of DNA to the transcriptional machinery."],
    }];
    const shown = titles("cells", subtopics);
    expect(shown).not.toContain("Dynamics, Tempo & Articulation");
    expect(shown).toContain("Animal vs Plant Cell");
  });

  it("works from the topic alone before a level's syllabus is read", () => {
    expect(titles("the periodic table", [])).toEqual(["Periodic Table of the Elements"]);
    expect(titles("volcanoes", [])).toEqual([]);
  });

  // Review of TerraTutor #249: the floor is the grounding one (6) for a course's own subject too. A lower one
  // was tried on 120 topics and titles: 4.5 adds Newton's Laws & Forces here and both economics cards for
  // "economics" (5.9), but also Circle of Fifths for "Circles", Spanish and French numbers for "Counting to
  // 100" and Map Symbols for "Scales and Keys". Below the floor the tab lists the Library A to Z instead.
  it("keeps the grounding floor for the course's own subject: a near miss is left out, not shown", () => {
    const gravity = [
      { title: "What is Gravity?", key_concepts: ["Gravity pulls objects toward each other."] },
      { title: "Newton's Law of Universal Gravitation", key_concepts: ["Mass and distance change the pull."] },
      { title: "Falling Objects", key_concepts: ["Objects fall at the same rate without air."] },
    ];
    expect(titles("gravity", gravity)).toEqual([]);
    expect(titles("Newton's Laws of Motion", [])).toEqual(["Newton's Laws & Forces"]);
  });

  // Port of TerraTutor #253: measured over 139 topics and subtopic titles (course-resources-topics.ts).
  // Before the fix the tab recommended 51 cards for them, 45 right and 6 wrong; now 45, all right.
  it("recommends exactly the hand-judged cards for each of the 139 topics and titles", () => {
    expect(RESOURCE_TOPICS).toHaveLength(139);
    const shown = Object.fromEntries(
      RESOURCE_TOPICS.map((t) => [t, courseResources(t, [], manifest).map((e) => e.id)] as const).filter(([, ids]) => ids.length),
    );
    expect(shown).toEqual(RIGHT_CARDS);
    expect(Object.values(shown).flat()).toHaveLength(45);
  });

  it("never recommends a card a one-word topic only names inside a longer alias", () => {
    for (const [topic, id] of WRONG_CARDS) {
      expect(manifest.some((e) => e.id === id), id).toBe(true);
      expect(courseResources(topic, [], manifest).map((e) => e.id), topic).not.toContain(id);
    }
  });

  it("keeps a one-word topic's card when the card's tags name it", () => {
    // "geography terms" is an alias of the Landform Glossary and "geography" one of its tags.
    expect(titles("Geography", [])).toEqual(["Landform Glossary"]);
    expect(titles("Geometry", [])).toEqual(["Geometry Formulas"]);
  });

  // Review of the #253 port: tokenize folds a plural by cutting one "s", so the tag "gases" became "gase" and
  // never matched a course called Gas. The tag check reads "-es" and "-ies" plurals as their singular.
  it.each([
    ["Gas", "chemistry/gas-laws"],
    ["Prefix", "ela/prefixes"],
    ["Suffix", "ela/suffixes"],
    ["Country", "geography/countries-capitals"],
    ["Tornado", "earth-space/storm-scales"],
    ["Lens", "physics/optics"],
  ])("keeps %s's card when a tag names the word as an -es or -ies plural", (topic, id) => {
    expect(courseResources(topic, [], manifest).map((e) => e.id)).toContain(id);
  });

  // Port of TerraTutor #254. The #253 port dropped these: the card named the word only in a keyword alias
  // ("nucleus mitochondria ribosome"). Each card now carries the word as a tag.
  it.each([
    ["Mitochondria", "biology/organelle-functions"],
    ["Igneous", "earth-space/rock-cycle"],
    ["Greek", "ela/greek-latin-roots"],
    ["Latin", "ela/greek-latin-roots"],
    ["Spectrum", "physics/electromagnetic-spectrum"],
    ["Precipitation", "earth-space/water-cycle"],
    ["Condensation", "earth-space/water-cycle"],
    ["Trig", "math/unit-circle"],
    ["Trig", "math/trig-identities"],
    ["Electric", "physics/electric-and-magnetic-fields"],
    ["Colour", "visual-art/color-wheel"],
    ["Sun", "earth-space/solar-system-planets"],
    ["The Sun", "earth-space/solar-system-planets"],
  ])("keeps %s's card now that the card's tags name the word (%s)", (topic, id) => {
    expect(courseResources(topic, [], manifest).map((e) => e.id)).toContain(id);
  });

  // "X Axis" has one token ("x" is too short) and lost the Coordinate Plane, whose alias "x axis y axis" its
  // tags don't repeat. A one-letter word counts as a word; a number does not.
  it("keeps the Coordinate Plane for X Axis and Y Axis, and gives 1 to 10 no Bill of Rights", () => {
    expect(courseResources("X Axis", [], manifest).map((e) => e.id)).toContain("math/coordinate-plane");
    expect(courseResources("Y Axis", [], manifest).map((e) => e.id)).toContain("math/coordinate-plane");
    expect(courseResources("1 to 10", [], manifest).map((e) => e.id)).not.toContain("us-history-civics/bill-of-rights");
  });
});
