import { describe, it, expect, beforeAll } from "vitest";
import { resolveDomainSkill, matchSkillsForCourse, isSkillAvailable } from "./trigger";
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
    ["Ear Anatomy: Eardrums", undefined],
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

    // Unrouted general/language/science topics
    ["Beginner Spanish", undefined],
    ["Introductory Chemistry", undefined],
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
