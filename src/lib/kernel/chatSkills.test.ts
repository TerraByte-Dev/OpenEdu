import { describe, it, expect, vi } from "vitest";

// Which tools a chat turn offers on a course, through chatTurnSkills (what ChatTab calls) and
// selectTools (what the kernel offers the model). Click test 2026-11-14: a course called only
// "Fractions" got no math skill, so diagram.render was never offered and the tutor could not draw.
// Routing reads the course's topic and stored syllabus on every turn, so a course made before the
// fix routes the same as a new one: nothing is stored at creation.

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

import { chatTurnMode, chatTurnSkills } from "./chatSkills";
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
    expect(chatTabSource).toMatch(/chatTurnSkills\(mode, course\.topic, modelTier, profile\.supportsTools, currentSyllabus\)/);
  });
});

// The mode ChatTab sends: the chip's, else the one the conversation calls for (chatTurnMode).
describe("chatTurnMode", () => {
  const u = (content: string) => ({ role: "user", content });
  const a = (content: string) => ({ role: "assistant", content });
  const ASK = "Check if I've got this.";

  it("ChatTab derives the mode from the chip and the conversation it sends", () => {
    // With no chip, "Ask again" on a saved "Check if I've got this." still opens the check (chat-check-chip.test.ts).
    expect(chatTabSource).toMatch(/const mode = chatTurnMode\(pendingMode \?\? \(saved\?\.content\.trim\(\) === ASSESS_MESSAGE \? "assess" : null\), \[\.\.\.history, \{ role: "user", content: userText \}\]\);/);
  });

  it("a chip's mode wins", () => {
    expect(chatTurnMode("hint", [u(ASK), a("What is 6 x 8?"), u("48")])).toBe("hint");
  });

  it("runs a check's typed answers in assess, for as long as the check lasts", () => {
    expect(chatTurnMode(null, [u(ASK), a("What is 6 x 8?"), u("48")])).toBe("assess");
    const four = [u(ASK), a("Q1?"), u("a"), a("Q2?"), u("b"), a("Q3?"), u("c"), a("Q4?"), u("d")];
    expect(chatTurnMode(null, four)).toBe("assess");
    expect(chatTurnMode(null, [...four, a("Q5?"), u("e")])).toBe("explain");
  });

  it("keeps a check open through hints, a hint's answer and a non-answer (TerraTutor click test 2026-11-19 part 7, issue 1)", () => {
    const conversation = [
      u(ASK), a("What is 6 x 8?"),
      u("Give me a hint."), a("Count by 8s. What is 8 + 8?"),
      u("16"), a("Yes, 8 + 8 = 16.\n\nNow back to the question:\n\nWhat is 6 x 8?"),
      u("xyz"), a("That doesn't answer the question yet. Here it is again:\n\nWhat is 6 x 8?"),
      u("hint"), a("5 x 8 is 40. What is 40 + 8?"),
      u("48"),
    ];
    expect(chatTurnMode(null, conversation)).toBe("assess");
  });

  it("leaves a typed request for a quiz or a check, and its answers, in the default mode", () => {
    // Assess drops the domain skill's drawing tools, and assess.md ends the check when every subtopic
    // is mastered, so a typed "quiz me" in assess lost its pictures and, on a mastered course, its quiz.
    for (const request of ["quiz me on fractions", "test me", "Okay, can you check if I've got this?"]) {
      expect(chatTurnMode(null, [u(request)])).toBe("explain");
      expect(chatTurnMode(null, [u(request), a("What is 6 x 8?"), u("48")])).toBe("explain");
    }
  });

  it("leaves a request for help during a check, and a quiz chip's answers, in the default mode", () => {
    expect(chatTurnMode(null, [u(ASK), a("What is 6 x 8?"), u("Give me a hint.")])).toBe("explain");
    expect(chatTurnMode(null, [u("Quiz me on this."), a("What is 6 x 8?"), u("48")])).toBe("explain");
    expect(chatTurnMode(null, [u("Teach me times tables."), a("What is 6 x 8?"), u("48")])).toBe("explain");
  });

  it("keeps the answers to the quiz chip's message edited by the child in the default mode", () => {
    // The chip fills the box and the child may change it before sending; the chip's quiz mode covers
    // only that send.
    expect(chatTurnMode("quiz", [u("Quiz me on this, please.")])).toBe("quiz");
    expect(chatTurnMode(null, [u("Quiz me on this, please."), a("What is 6 x 8?"), u("48")])).toBe("explain");
    expect(chatTurnMode(null, [u("Quiz me on fractions."), a("What is 1/2 of 8?"), u("4")])).toBe("explain");
  });

  it("follows the newest request: a typed quiz after the check chip ends the check's assess turns", () => {
    expect(chatTurnMode(null, [u(ASK), a("What is 6 x 8?"), u("48"), a("Right."), u("quiz me on fractions"), a("What is 1/2 of 8?"), u("4")])).toBe("explain");
    expect(chatTurnMode(null, [u("quiz me"), a("What is 6 x 8?"), u("48"), a("Right."), u(ASK), a("What is 7 x 9?"), u("63")])).toBe("assess");
  });

  // TerraTutor live test 2026-11-21 part 14, issue 10 (ported from TerraTutor #280): the chip's own words typed ran in explain mode, so no topic picker came.
  it("runs the chip's own words typed in assess, as the chip, and their answers too: case, end marks and spaces aside", () => {
    for (const typed of ["Check if I've got this", "check if i've got this", "CHECK IF I'VE GOT THIS!!", "  Check  if I’ve got this. ", "check if i've got this?"]) {
      expect(chatTurnMode(null, [u(typed)])).toBe("assess");
      expect(chatTurnMode(null, [u(typed), a("What is 6 x 8?"), u("48")])).toBe("assess");
    }
  });

  it("leaves any other wording of it in the default mode", () => {
    for (const typed of ["Check if I've got this right", "please check if I've got this", "Check if I got this", "check if ive got this"]) {
      expect(chatTurnMode(null, [u(typed)])).toBe("explain");
    }
  });
});

describe("tools offered on a check's answer turn", () => {
  it("include progress.mark_mastered and ask_user.question", async () => {
    const { activeSkill, domainSkill } = chatTurnSkills(chatTurnMode(null, [{ role: "user", content: "Check if I've got this." }, { role: "assistant", content: "What is 6 x 8?" }, { role: "user", content: "48" }]), "Fractions", "tiny", true);
    const ctx: ToolContext = {
      courseId: "c1", level: 1, syllabus: null, modelTier: "tiny", permissionMode: "default",
      config: { provider: "ollama", model: "test" } as LLMConfig, abort: new AbortController().signal,
      activeSkill, domainSkill, supportsTools: true,
    };
    const names = (await selectTools(ctx)).map((t) => t.name);
    expect(names).toContain("progress.mark_mastered");
    expect(names).toContain("ask_user.question");
  });
});
