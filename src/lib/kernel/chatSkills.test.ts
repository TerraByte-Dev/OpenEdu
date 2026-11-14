import { describe, it, expect, vi } from "vitest";

// Which tools a chat turn offers on a course, through chatTurnSkills (what ChatTab calls) and
// selectTools (what the kernel offers the model). Click test 2026-11-14: a course called only
// "Fractions" got no math skill, so diagram.render was never offered and the tutor could not draw.
// Routing reads the course's topic and stored syllabus on every turn, so a course made before the
// fix routes the same as a new one: nothing is stored at creation.

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

import { chatTurnSkills } from "./chatSkills";
import { selectTools } from "./toolDispatch";
import { registerBuiltinTools } from "../tools";
import type { ToolContext } from "../tools/EduTool";
import type { LLMConfig, Syllabus } from "../../types";
import chatTabSource from "../../components/ChatTab.tsx?raw";

registerBuiltinTools();

async function offered(topic: string, syllabus: Syllabus | null = null): Promise<string[]> {
  const { activeSkill, domainSkill } = chatTurnSkills("explain", topic, "tiny", true, syllabus);
  const ctx: ToolContext = {
    courseId: "c1", level: 1, syllabus, modelTier: "tiny", permissionMode: "default",
    config: { provider: "ollama", model: "test" } as LLMConfig, abort: new AbortController().signal,
    activeSkill, domainSkill, supportsTools: true,
  };
  return (await selectTools(ctx)).map((t) => t.name);
}

// A syllabus row as an existing course has it in the database (db.ts getSyllabus).
const STORED: Syllabus = {
  id: "syl1", course_id: "c1", level: 1, title: "Parts of a Whole", description: "Sharing things fairly.",
  learning_objectives: ["Name halves and quarters"], assessment_criteria: [], estimated_hours: 2, generated_at: "2026-10-01",
  subtopics: [
    { id: "a", title: "Halves", key_concepts: ["two equal parts", "one half is a fraction"], practice_type: "practice", mastered: true },
    { id: "b", title: "Quarters", key_concepts: ["four equal parts", "fraction of a shape"], practice_type: "practice", mastered: false },
    { id: "c", title: "Fair Shares", key_concepts: ["equal shares"], practice_type: "practice", mastered: false },
  ],
};

describe("domain tools offered on a course", () => {
  it("offers diagram.render and math.render on a course called only \"Fractions\"", async () => {
    const names = await offered("Fractions");
    expect(names).toContain("diagram.render");
    expect(names).toContain("math.render");
  });

  it("offers diagram.render on a science course, without math.render", async () => {
    const names = await offered("The Water Cycle");
    expect(names).toContain("diagram.render");
    expect(names).not.toContain("math.render");
  });

  it("offers neither on Poetry", async () => {
    const names = await offered("Poetry");
    expect(names).not.toContain("diagram.render");
    expect(names).not.toContain("math.render");
  });

  it("routes an existing course by its stored syllabus when the title names no subject", async () => {
    expect(await offered("Sharing Snacks")).not.toContain("diagram.render");
    expect(await offered("Sharing Snacks", STORED)).toContain("diagram.render");
  });

  it("ChatTab passes the course's syllabus to chatTurnSkills", () => {
    expect(chatTabSource).toMatch(/chatTurnSkills\(activeMode, course\.topic, modelTier, profile\.supportsTools, currentSyllabus\)/);
  });
});
