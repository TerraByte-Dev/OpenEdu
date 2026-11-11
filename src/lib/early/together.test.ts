import { describe, it, expect } from "vitest";
import { SKILLS } from "./packs";
import { TRY_TOGETHER, mixUpIdea, togetherIdeas } from "./together";
import { skillReports, type Confusion, type SkillReport } from "./report";
import type { SkillId } from "./types";

const ALL_IDS = Object.keys(SKILLS) as SkillId[];

// Words that should never reach a K-1 activity list: small things a younger sibling could swallow,
// sharp things, heat, and water play. A test, not a filter: the content is hand-written and reviewed.
const UNSAFE = /\b(coins?|beads?|marbles?|balloons?|batter(y|ies)|magnets?|grapes?|popcorn|nuts?|candy|beans?|pebbles?|knife|knives|scissors|stove|oven|cook|bake|boil|hot|bath|pool|pond|lake|sink|tub|matches|lighter|pins?|needles?)\b/i;

describe("try-together content", () => {
  it("has hand-written ideas for every skill", () => {
    for (const id of ALL_IDS) expect(TRY_TOGETHER[id].length, id).toBeGreaterThanOrEqual(3);
  });

  it("names nothing unsafe for a young child, here or on the home screen's play-together line", () => {
    const texts = [
      ...Object.values(TRY_TOGETHER).flat().flatMap((i) => [i.title, i.how]),
      ...Object.values(SKILLS).flatMap((s) => s.playTogether),
      ...(["colors", "count-1-10", "count-11-20", "shapes"] as SkillId[]).flatMap((skillId) => {
        const i = mixUpIdea({ skillId, a: "13", b: "14", times: 3 }, "Sam");
        return [i.title, i.how];
      }),
    ];
    for (const t of texts) expect(t, t).not.toMatch(UNSAFE);
  });

  it("says to hold on near stairs", () => {
    const texts = [...Object.values(TRY_TOGETHER).flat().map((i) => i.how), ...Object.values(SKILLS).flatMap((s) => s.playTogether)];
    for (const t of texts) if (/stair/i.test(t)) expect(t, t).toMatch(/hold hands|rail/i);
  });

  it("keeps traffic at a distance", () => {
    const texts = [...Object.values(TRY_TOGETHER).flat().map((i) => i.how), ...Object.values(SKILLS).flatMap((s) => s.playTogether)];
    for (const t of texts) if (/\b(cars?|trucks?|street|road)\b/i.test(t)) expect(t, t).toMatch(/window|grown-up/i);
  });
});

describe("togetherIdeas", () => {
  const report = (id: SkillId, status: SkillReport["status"]): SkillReport =>
    ({ ...skillReports([]).find((r) => r.id === id)!, status });

  it("picks ideas only for skills being learned", () => {
    const reports = [report("colors", "mastered"), report("count-1-10", "learning"), report("count-11-20", "not-yet"), report("shapes", "not-yet")];
    const out = togetherIdeas(reports, [], "Sam");
    expect(out.length).toBe(3);
    expect(out.every((o) => o.skillId === "count-1-10")).toBe(true);
    expect(out.map((o) => o.idea)).toEqual(TRY_TOGETHER["count-1-10"]);
  });

  it("takes turns between skills, puts a mix-up first, and stops at max", () => {
    const reports = [report("colors", "learning"), report("shapes", "learning")];
    const c: Confusion = { skillId: "shapes", a: "rectangle", b: "square", times: 4 };
    const out = togetherIdeas(reports, [c], "Sam", 4);
    expect(out.map((o) => o.skillId)).toEqual(["colors", "shapes", "colors", "shapes"]);
    expect(out[1].idea).toEqual(mixUpIdea(c, "Sam"));
    expect(out[1].idea.how).toContain("Sam mixes these up");
  });

  it("is empty when nothing is being learned", () => {
    expect(togetherIdeas(skillReports([]), [], "Sam")).toEqual([]);
  });
});
