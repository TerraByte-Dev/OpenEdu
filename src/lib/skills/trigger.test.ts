import { describe, it, expect, beforeAll } from "vitest";
import { resolveDomainSkill, matchSkillsForCourse, isSkillAvailable, type CourseSyllabus } from "./trigger";
import {
  MATH_SWEEP, SCIENCE_SWEEP, PHYSICS_SWEEP, OTHER_SWEEP, HELDOUT_MATH, HELDOUT_SCIENCE, HELDOUT_OTHER,
} from "./subjectSweep";
import { buildSkill, loadBuiltinSkills, skillRegistry } from "./registry";
import { registerBuiltinTools } from "../tools/builtins";
import { toolRegistry } from "../tools/registry";
import { GOLDENS } from "../eval/goldens";

const rawSkillBundles = import.meta.glob("../../../src/skills/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function assertToolsRegistered(toolsRequired: string[], registeredNames: Set<string>): void {
  for (const toolName of toolsRequired) {
    if (!registeredNames.has(toolName)) {
      throw new Error(`Unregistered tool "${toolName}" in tools_required`);
    }
  }
}

beforeAll(() => {
  registerBuiltinTools();
  loadBuiltinSkills();
});

describe("domain skill routing (word-boundary matching)", () => {
  const routingTable: Array<[string, string | undefined]> = [
    // Previously misrouted substring false positives → undefined
    ["Animal Husbandry", undefined],
    ["First Aid: Bandaging Wounds", undefined],
    ["Ear Anatomy: Eardrums", "science-tutor"], // "drums" no longer matches music; "anatomy" is science
    ["Metaphysics", undefined],
    ["Aftermath of World War I", undefined],
    ["Trusts and Estates", undefined],
    ["Earth's Crust", undefined],
    ["Javanese History", undefined],
    ["Decoding Hieroglyphs", undefined],

    // Routed topics (exact, plural, and adjective forms)
    ["Introductory Algebra", "math-tutor"],
    ["Algebraic Topology", "math-tutor"],
    ["Classical Physics", "math-tutor"],
    ["Mathematical Reasoning", "math-tutor"],
    ["Applied Statistics", "math-tutor"],
    ["Python Programming", "code-tutor"],
    ["Computer Science 101", "code-tutor"],
    ["Musical Theatre", "music-tutor"],
    ["Beginner Guitars", "music-tutor"],
    ["Orchestral Arrangement", "music-tutor"],
    ["Rhythmic Training", "music-tutor"],

    // Multiple domains match → first registered skill wins
    ["Music Programming", "code-tutor"],

    // Unrouted general/language topics; science routes to science-tutor
    ["Beginner Spanish", undefined],
    ["Introductory Chemistry", "science-tutor"],
    ["General Knowledge", undefined],
  ];

  it.each(routingTable)("routes %j → %s", (topic, expected) => {
    expect(resolveDomainSkill(topic, "tiny")?.name).toBe(expected);
  });

  it("pins every golden topic in GOLDENS", () => {
    const pinnedTopics = new Map(routingTable);
    for (const golden of GOLDENS) {
      expect(
        pinnedTopics.has(golden.topic),
        `Golden "${golden.id}" topic "${golden.topic}" is missing from routingTable`,
      ).toBe(true);
      expect(resolveDomainSkill(golden.topic, "tiny")?.name).toBe(pinnedTopics.get(golden.topic));
    }
  });

  it("matches plurals in both directions (singular keyword matches plural topic, and -s keyword still matches itself)", () => {
    expect(resolveDomainSkill("Acoustic Guitars", "tiny")?.name).toBe("music-tutor");
    expect(resolveDomainSkill("Statistics", "tiny")?.name).toBe("math-tutor");
  });

  it("respects model_tier_min when filtering skills", () => {
    const highTierSkill = buildSkill(
      [
        "---",
        "name: advanced-math",
        "description: Needs large tier.",
        "trigger:",
        "  course_subject: [calculus]",
        "model_tier_min: large",
        "---",
        "Body",
      ].join("\n"),
    );
    expect(isSkillAvailable(highTierSkill, "small")).toBe(false);
    expect(isSkillAvailable(highTierSkill, "large")).toBe(true);
    expect(matchSkillsForCourse({ topic: "Calculus I" }, [highTierSkill], "small")).toEqual([]);
    expect(matchSkillsForCourse({ topic: "Calculus I" }, [highTierSkill], "large")).toEqual([
      highTierSkill,
    ]);
  });
});

// Click test 2026-11-14: a course called only "Fractions" got no math skill, so diagram.render was
// never offered. Before the fix (topic words math/algebra/geometry/…, no science skill): 33 of 42
// sweep math courses and 26 of 40 held-out math courses got no math skill; no science course got a
// science skill (22 of 22, 30 of 30).
describe("K-12 course sweep (subjectSweep.ts)", () => {
  const route = (t: string) => resolveDomainSkill(t, "tiny")?.name;

  it.each(MATH_SWEEP)("math: %j → math-tutor", (t) => expect(route(t)).toBe("math-tutor"));
  it.each(SCIENCE_SWEEP)("science: %j → science-tutor", (t) => expect(route(t)).toBe("science-tutor"));
  it.each(PHYSICS_SWEEP)("physics: %j → math-tutor", (t) => expect(route(t)).toBe("math-tutor"));
  it.each(OTHER_SWEEP)("other: %j → %s", (t, want) => expect(route(t)).toBe(want));

  // Held-out titles: never tuned against. These are the titles the topic alone still misses; such a
  // course routes by its syllabus instead (below).
  const HELDOUT_MISSES = new Set([
    "Number Bonds", "Mean, Median, and Mode",
    "Phases of the Moon", "The Digestive System", "Layers of the Earth", "Acids and Bases",
  ]);
  it("held out: 38 of 40 math and 26 of 30 science titles route by topic alone, no other title does", () => {
    const missed = [
      ...HELDOUT_MATH.filter((t) => route(t) !== "math-tutor"),
      ...HELDOUT_SCIENCE.filter((t) => route(t) !== "science-tutor"),
    ];
    expect(new Set(missed)).toEqual(HELDOUT_MISSES);
    for (const t of missed) expect(route(t), t).toBeUndefined();
    for (const [t, want] of HELDOUT_OTHER) expect(route(t), t).toBe(want);
  });

  it("keeps words that name another subject from routing", () => {
    for (const t of ["Political Science", "Social Science", "Animal Farm", "Counting Syllables", "Circuit Training", "Spanish Numbers"]) {
      expect(route(t), t).toBeUndefined();
    }
    expect(route("Computer Science 101")).toBe("code-tutor");
    // Known and accepted: an art course about shapes is offered the math tools.
    expect(route("Shapes in Art")).toBe("math-tutor");
  });
});

describe("routing by the syllabus when the topic names no subject", () => {
  const syl = (subtopics: Array<[string, string[]]>): CourseSyllabus => ({
    subtopics: subtopics.map(([title, key_concepts], i) => ({
      id: `s${i}`, title, key_concepts, practice_type: "practice", mastered: false,
    })),
  });

  const PIZZA = syl([
    ["Halves and Quarters", ["equal parts", "fraction", "numerator and denominator"]],
    ["Comparing Slices", ["compare fractions", "greater than and less than"]],
    ["Sharing Fairly", ["equal shares", "parts of a whole"]],
  ]);
  const RAIN = syl([
    ["Evaporation", ["the water cycle", "heat from the sun"]],
    ["Clouds", ["condensation", "water vapor", "weather"]],
    ["Rain and Snow", ["precipitation", "weather"]],
    ["Puddles", ["collection", "runoff"]],
  ]);
  const POETRY = syl([
    ["Rhythm and Meter", ["rhythm", "stressed syllables"]],
    ["Rhyme Schemes", ["rhyme", "couplet"]],
    ["Imagery", ["metaphor", "simile"]],
    ["Writing a Haiku", ["syllable count", "nature words"]],
  ]);
  const COOKING = syl([
    ["Kitchen Safety", ["knives", "hot surfaces"]],
    ["Measuring Ingredients", ["measurement", "fraction of a cup"]],
    ["Following a Recipe", ["steps in order", "timing"]],
  ]);

  it("routes a course whose title names no subject by most of its subtopics", () => {
    expect(resolveDomainSkill("Pizza Party", "tiny", PIZZA)?.name).toBe("math-tutor");
    expect(resolveDomainSkill("Where Rain Comes From", "tiny", RAIN)?.name).toBe("science-tutor");
  });

  it("does not route on one subtopic that touches a subject", () => {
    expect(resolveDomainSkill("Poetry", "tiny", POETRY)).toBeUndefined();
    expect(resolveDomainSkill("Cooking Basics", "tiny", COOKING)).toBeUndefined();
  });

  it("lets the topic decide when it names a subject", () => {
    expect(resolveDomainSkill("Python Programming", "tiny", PIZZA)?.name).toBe("code-tutor");
    expect(resolveDomainSkill("Pizza Party", "tiny", null)).toBeUndefined();
  });

  it("needs at least two subtopics", () => {
    const one = syl([["Halves", ["fraction"]]]);
    expect(resolveDomainSkill("Pizza Party", "tiny", one)).toBeUndefined();
  });
});

describe("skill-bundle contract", () => {
  const entries = Object.entries(rawSkillBundles);

  it("loads every src/skills/*.md bundle cleanly through buildSkill", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, raw] of entries) {
      expect(() => buildSkill(raw), `Bundle failed buildSkill: ${path}`).not.toThrow();
    }
    expect(skillRegistry.all().length).toBe(entries.length);
  });

  it("requires every tools_required entry to be a registered built-in tool", () => {
    const registeredNames = new Set(toolRegistry.all().map((t) => t.name));
    expect(registeredNames.size).toBeGreaterThan(0);

    for (const [path, raw] of entries) {
      const skill = buildSkill(raw);
      expect(
        () => assertToolsRegistered(skill.tools_required, registeredNames),
        `Bundle ${path} references an unregistered tool`,
      ).not.toThrow();
    }
  });

  it("fails the contract check when a fixture bundle names an unregistered tool", () => {
    const registeredNames = new Set(toolRegistry.all().map((t) => t.name));
    const badFixture = buildSkill(
      [
        "---",
        "name: fixture-bad-tool",
        "description: Fixture skill with an unknown tool.",
        "tools_required: [nonexistent.tool]",
        "---",
        "Fixture body.",
      ].join("\n"),
    );
    expect(() => assertToolsRegistered(badFixture.tools_required, registeredNames)).toThrow(
      /nonexistent\.tool/,
    );
  });

  it("keeps tools_required empty on all sprite-persona-* bundles", () => {
    const personaBundles = entries
      .map(([, raw]) => buildSkill(raw))
      .filter((s) => s.name.startsWith("sprite-persona-"));
    expect(personaBundles.length).toBeGreaterThan(0);
    for (const persona of personaBundles) {
      expect(persona.tools_required, `${persona.name} must not set tools_required`).toEqual([]);
    }
  });
});
