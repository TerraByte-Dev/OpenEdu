import { describe, it, expect } from "vitest";
import { k12FlowTurnSetup, K12_FLOW_TOPICS } from "./k12-flow-prompt";
import { K12_INSTRUCTIONS } from "./k12-runner";
import { K12_ITEMS } from "./k12-items";
import { chatTurnSkills } from "../kernel/chatSkills";
import { buildSystemPrompt, LEGACY_TUTOR_RULES, TUTOR_RULES } from "../curriculum";
import chatTabSource from "../../components/ChatTab.tsx?raw";
import k12FlowRunnerSource from "./k12-flow-runner.ts?raw";

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

// ChatTab is React and has no unit tests, so this pins the wiring instead: the swap lives in
// tutorEngine.run, and ChatTab and the k12-flow runner both send their turn through it, with the
// system prompt buildSystemPrompt builds. Neither decides the worked-answer turn or the first-turn
// hold itself.
describe("one function for ChatTab and the eval", () => {
  for (const [name, src] of [["ChatTab.tsx", chatTabSource], ["k12-flow-runner.ts", k12FlowRunnerSource]] as const) {
    it(`${name} sends its turn through tutorEngine.run and does not fork the rule`, () => {
      expect(src).toMatch(/tutorEngine\.run\(/);
      expect(src).not.toMatch(/WORKED_ANSWER_RULES|isWorkedAnswerTurn|turnSystemPrompt|outputRulesLayer|FIRST_TURN_HOLD_NOTE|isFirstTurnHold|withFirstTurnHold|posesNewProblem|tutor_note/);
    });
  }
});

describe("k12FlowTurnSetup's rules arms (lever 16, EVAL_COURSE_RULES)", () => {
  const item = { subject: "math" as const };
  it("sends no rules block by default, the frozen protocol's prompt", () => {
    expect(k12FlowTurnSetup(item, "tiny", true).system).toBe(k12FlowTurnSetup(item, "tiny", true, "none").system);
    expect(k12FlowTurnSetup(item, "tiny", true).system).not.toContain("## Rules");
  });
  it("adds the code rules block for \"code\" and master's stored block for \"legacy\", and changes nothing else", () => {
    const none = k12FlowTurnSetup(item, "tiny", true, "none").system;
    const code = k12FlowTurnSetup(item, "tiny", true, "code").system;
    const legacy = k12FlowTurnSetup(item, "tiny", true, "legacy").system;
    expect(code).toContain(`## Rules\n${TUTOR_RULES}`);
    expect(legacy).toContain(`## Rules\n${LEGACY_TUTOR_RULES}`);
    const SEP = "\n\n---\n\n";
    expect(code.replace(`${SEP}## Rules\n${TUTOR_RULES}`, "")).toBe(none);
    expect(legacy.replace(`${SEP}## Rules\n${LEGACY_TUTOR_RULES}`, "")).toBe(none);
  });
});

