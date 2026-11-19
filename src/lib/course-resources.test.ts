import { describe, it, expect } from "vitest";
import manifestJson from "../../public/library/index.json";
import { normalizeManifest, matchResources } from "./library-rank";
import { courseResources } from "./course-resources";

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
});
