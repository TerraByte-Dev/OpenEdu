import { describe, it, expect } from "vitest";
import { k12FlowTurnSetup, K12_FLOW_TOPICS } from "./k12-flow-prompt";
import { K12_INSTRUCTIONS } from "./k12-runner";
import { K12_ITEMS } from "./k12-items";
import { chatTurnSkills } from "../kernel/chatSkills";
import { buildSystemPrompt } from "../curriculum";

// The runner's system prompt must be the one ChatTab builds for a course with no stored tutor
// instructions, no persona, no syllabus and no knowledge summary, on the item's subject. The review
// of PR #178 caught the runner sending the RAG-eval prompt ("answer directly"), which pushes the
// model to reveal at T1, the very thing G1 measures.

const MATH = K12_ITEMS.find((x) => x.subject === "math")!;
const ELA = K12_ITEMS.find((x) => x.subject === "ela")!;

describe("k12FlowTurnSetup", () => {
  it("does not send the RAG-eval 'answer directly' prompt", () => {
    const { system } = k12FlowTurnSetup(MATH, "tiny", true);
    expect(system).not.toContain(K12_INSTRUCTIONS.pedagogy);
    expect(system).not.toContain(K12_INSTRUCTIONS.identity);
  });

  it("is ChatTab's prompt for the item's subject: default identity, subject fallback, explain + domain skill", () => {
    const { system, topic, activeSkill, domainSkill } = k12FlowTurnSetup(MATH, "tiny", true);
    expect(topic).toBe("Mathematics");
    expect(activeSkill?.name).toBe("explain");
    expect(domainSkill?.name).toBe("math-tutor");
    // ChatTab: buildSystemPrompt(instructions, currentSyllabus, level, course.topic, skillSuffix, knowledge, persona)
    const chatTab = buildSystemPrompt({}, null, 1, topic, chatTurnSkills("explain", topic, "tiny", true).skillSuffix);
    expect(system).toBe(chatTab);
    expect(system).toContain("You are a knowledgeable, encouraging tutor.");
    expect(system).toContain("You are tutoring the student on: Mathematics.");
    expect(system).toContain("## Math rendering");
  });

  it("drops the domain skill when the model has no tools, as ChatTab does (#127)", () => {
    const { system, domainSkill } = k12FlowTurnSetup(MATH, "tiny", false);
    expect(domainSkill).toBeNull();
    expect(system).not.toContain("## Math rendering");
  });

  it("routes no domain skill for a non-math subject", () => {
    expect(k12FlowTurnSetup(ELA, "tiny", true).domainSkill).toBeNull();
  });

  it("has a topic for every subject in the item set", () => {
    for (const x of K12_ITEMS) expect(K12_FLOW_TOPICS[x.subject]).toBeTruthy();
  });
});

describe("chatTurnSkills (shared with ChatTab)", () => {
  it("never pairs a domain skill with assess", () => {
    expect(chatTurnSkills("assess", "Mathematics", "tiny", true).domainSkill).toBeNull();
  });
});
