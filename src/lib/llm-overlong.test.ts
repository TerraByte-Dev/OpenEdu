import { describe, it, expect, afterEach, vi } from "vitest";

// B10 (TerraTutor src/lib/eval/results/2026-11-14-plus-bakeoff.md): claude-haiku-5-5 wrote 1-20% past
// the course pipeline's maxLength caps and two repairs never got it under, so 19 of 20 course builds
// failed. These tests run the course research step (curriculum.ts researchTopic) and callLLMStructured
// against a fake Anthropic endpoint that answers like Haiku did. Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMStructured, trimToLimit, trimOverlongStrings } from "./llm";
import { researchTopic } from "./curriculum";
import { generateQuizQuestions } from "./quiz";
import type { LLMConfig, Syllabus } from "../types";

const HAIKU = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test-key", modelTier: "large" } as LLMConfig;

// Over-long fields in the shape B10 saw: two long sentences where the cap is 400 (447 chars), and a
// domain focus of one long sentence where the cap is 200.
const WHAT_IT_IS =
  "Ancient Egypt was a civilization that grew up along the lower Nile River in northeastern Africa, lasting from about 3100 BCE, when Upper and Lower Egypt were united under one king, until the Roman conquest in 30 BCE. " +
  "Its people built pyramids and temples, developed hieroglyphic writing, organized farming around the river's yearly flood, and kept a strong central government led by pharaohs who were seen as both rulers and gods.";
const FOCUS_ONE_SENTENCE =
  "How farmers along the Nile used the yearly flood, basin irrigation, the shaduf and a calendar of three seasons to grow wheat, barley and flax, and how surplus grain supported scribes, priests, builders and the state";
const FOCUS_OK = "How hieroglyphs, hieratic script and papyrus records let scribes run taxes, temples and the law.";

type Sent = { tool: string; body: Record<string, unknown> };
let sent: Sent[] = [];
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; sent = []; });

// Structured calls go out as output_config.format (llm.ts callAnthropicStructured), which names no tool,
// so the fake tells the stages apart by the schema's first property, and answers in a text block.
const STAGE_BY_FIELD: Record<string, string> = {
  what_it_is: "emit_subject_overview", domains: "emit_knowledge_domains", stages: "emit_progression",
  obstacles: "emit_obstacles", prerequisites: "emit_prerequisites", verdicts: "emit_verdicts", questions: "emit_quiz_questions",
};
function stageOf(body: { output_config?: { format?: { schema?: { properties?: Record<string, unknown> } } } }): string {
  const fields = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  return fields.map((f) => STAGE_BY_FIELD[f]).find(Boolean) ?? "t";
}
function fakeAnthropic(reply: (tool: string, attempt: number) => unknown) {
  const attempts = new Map<string, number>();
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const tool = stageOf(body);
    const n = (attempts.get(tool) ?? 0) + 1;
    attempts.set(tool, n);
    sent.push({ tool, body });
    return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply(tool, n)) }] });
  }) as unknown as typeof fetch;
}

function researchReply(tool: string): unknown {
  switch (tool) {
    case "emit_subject_overview":
      return { what_it_is: WHAT_IT_IS, why_important: "Egypt shows how a river, a calendar and writing can hold a large state together for three thousand years.", mastery_unlocks: ["read a timeline of the dynasties", "explain the flood cycle", "compare Egypt with Mesopotamia"] };
    case "emit_knowledge_domains":
      return { domains: [
        { name: "Farming and the Nile", focus: FOCUS_ONE_SENTENCE },
        { name: "Writing", focus: FOCUS_OK },
        { name: "Religion", focus: "Gods, temples, burial customs and the belief in an afterlife that shaped tombs." },
        { name: "Government", focus: "Pharaohs, viziers, nomes and how taxes in grain paid for the state's projects." },
      ] };
    case "emit_progression":
      return { stages: ["beginner", "foundations", "working_knowledge", "intermediate", "advanced", "mastery"].map((stage) => ({
        stage, milestones: ["names the main periods", "places sites on a map"], can_build: "A labelled timeline of Egypt's main periods and rulers.",
      })) };
    case "emit_obstacles":
      return { obstacles: [1, 2, 3].map((i) => ({ what_blocks_learners: `Mixing up the Old and New Kingdoms (${i}).`, common_misconception: `Thinking every pharaoh built a pyramid (${i}).` })) };
    default:
      return { prerequisites: [], assume_none_needed: true };
  }
}

describe("a cloud model writing past maxLength no longer fails the course build", () => {
  it("research: Haiku-style over-long fields are trimmed at a sentence or word boundary, with no repair call", async () => {
    fakeAnthropic((tool) => researchReply(tool));
    const brief = await researchTopic("Ancient Egypt", { ...HAIKU });

    // One request per research stage: the length problem cost no repair attempts.
    expect(sent.map((s) => s.tool).sort()).toEqual(["emit_knowledge_domains", "emit_obstacles", "emit_prerequisites", "emit_progression", "emit_subject_overview"]);
    // what_it_is keeps its first whole sentence (216 chars) rather than a cut mid-way through the second.
    const firstSentence = WHAT_IT_IS.slice(0, WHAT_IT_IS.indexOf("30 BCE.") + "30 BCE.".length);
    expect(brief).toContain(`## Subject Overview\n${firstSentence}\n`);
    expect(brief).not.toContain("hieroglyphic writing");
    // The one-sentence focus is cut after a whole word, marked with an ellipsis, within the cap.
    const focusLine = brief.split("\n").find((l) => l.startsWith("- **Farming and the Nile**"))!;
    const focus = focusLine.replace("- **Farming and the Nile** — ", "");
    expect(focus.length).toBeLessThanOrEqual(200);
    expect(focus.endsWith("…")).toBe(true);
    expect(FOCUS_ONE_SENTENCE.startsWith(focus.slice(0, -1))).toBe(true);
    expect(FOCUS_ONE_SENTENCE[focus.length - 1]).toMatch(/[\s,]/); // the cut fell between words
    expect(brief).toContain(FOCUS_OK);
  });

  it("the cap reaches Anthropic only as words in the description (structured outputs reject maxLength), so nothing there enforces it", async () => {
    fakeAnthropic((tool) => researchReply(tool));
    await researchTopic("Ancient Egypt", { ...HAIKU });
    const overview = sent.find((s) => s.tool === "emit_subject_overview")!.body;
    const schema = (overview.output_config as { format: { schema: { properties: Record<string, { maxLength?: number; description?: string }> } } }).format.schema;
    expect(schema.properties.what_it_is.maxLength).toBeUndefined();
    expect(schema.properties.what_it_is.description).toContain("at most 400 characters");
    expect(overview).not.toHaveProperty("tool_choice");
  });

  it("does not trim when something besides length is wrong; the repair prompt gets the issues", async () => {
    const schema = { type: "object", additionalProperties: false, required: ["a", "b"], properties: { a: { type: "string", maxLength: 40 }, b: { type: "string" } } };
    fakeAnthropic((_t, n) => (n === 1 ? { a: "This answer is far too long for its field. It goes on." } : { a: "Short and fine.", b: "x" }));
    const out = await callLLMStructured<{ a: string; b: string }>([{ role: "user", content: "go" }], { ...HAIKU }, { schema, toolName: "t" });
    expect(out).toEqual({ a: "Short and fine.", b: "x" });
    expect(sent).toHaveLength(2);
    const msgs = sent[1].body.messages as Array<{ content: string }>;
    const repair = msgs[msgs.length - 1].content;
    expect(repair).toContain("$.b: missing required field");
    expect(repair).toContain("$.a: string too long");
  });

  it("does not accept a trim the caller's own checks reject; it repairs instead", async () => {
    // A quiz explanation must end with "Therefore the answer is X"; trimming it off would break that.
    const schema = { type: "object", additionalProperties: false, required: ["explanation"], properties: { explanation: { type: "string", maxLength: 60 } } };
    const long = "Twelve eggs fill one carton, and two cartons hold twice as many. Therefore the answer is 24";
    fakeAnthropic((_t, n) => ({ explanation: n === 1 ? long : "Two cartons of 12. Therefore the answer is 24" }));
    const out = await callLLMStructured<{ explanation: string }>([{ role: "user", content: "go" }], { ...HAIKU }, {
      schema, toolName: "t", validate: (p) => (/Therefore the answer is \S+$/.test(p.explanation) ? [] : ["explanation must end with the answer"]),
    });
    expect(out.explanation).toBe("Two cartons of 12. Therefore the answer is 24");
    expect(sent).toHaveLength(2);
  });

  it("quiz questions are never trimmed: a long word problem would lose the sentence that asks it", async () => {
    const setup = "A farmer has a field that is 120 meters long and 80 meters wide, and she plants rows of corn along its length with one meter between rows. ".repeat(3);
    const q = (text: string) => ({ questions: [{ question_text: text, question_type: "short_answer", options: [], correct_answer: "81",
      difficulty_level: 1, explanation: "One row at 0 m and one each meter after it up to 80 m. Therefore the answer is 81", subtopic_id: "1.1", blank_position: "", matching_pairs: [] }] });
    fakeAnthropic((tool, n) => (tool === "emit_verdicts" ? { verdicts: [] } : q(n === 1 ? `${setup}How many rows does she plant?` : "A field is 80 m wide with a row every meter from 0 to 80 m. How many rows does she plant?")));
    const syllabus = { level: 1, title: "Counting", subtopics: [{ id: "1.1", title: "Fence posts", key_concepts: ["counting gaps"] }] } as unknown as Syllabus;
    const qs = await generateQuizQuestions(syllabus, 1, { ...HAIKU });
    expect(sent.filter((s) => s.tool === "emit_quiz_questions")).toHaveLength(2); // a repair, not a trim
    expect(qs[0].question_text).toMatch(/How many rows does she plant\?$/);
  });

  it("still fails when a field cannot be shortened without cutting a word", async () => {
    const schema = { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", maxLength: 10 } } };
    fakeAnthropic(() => ({ id: "supercalifragilistic" }));
    await expect(callLLMStructured([{ role: "user", content: "go" }], { ...HAIKU }, { schema, toolName: "t" }))
      .rejects.toThrow(/Structured output failed after 3 attempts.*string too long/);
  });
});

describe("trimToLimit", () => {
  it("returns text within the limit unchanged", () => {
    expect(trimToLimit("Short.", 10)).toBe("Short.");
  });
  it("keeps whole sentences and skips an abbreviation or a decimal as a sentence end", () => {
    const t = "The U.S. flag has 50 stars. Each stands for a state, e.g. Ohio. The stripes stand for 13 colonies.";
    expect(trimToLimit(t, 70)).toBe("The U.S. flag has 50 stars. Each stands for a state, e.g. Ohio.");
    expect(trimToLimit("Pi is about 3.14 and more digits follow forever after that point.", 30)).toBe("Pi is about 3.14 and more…");
  });
  it("never ends on a numbered list's marker", () => {
    const t = "Do it in steps.\n1. Count the bags.\n2. Find one bag's mass.\n3. Multiply the bags by the mass to get 12 kg.";
    expect(trimToLimit(t, t.indexOf("\n3.") + 8)).toBe("Do it in steps.\n1. Count the bags.\n2. Find one bag's mass.");
  });
  it("falls back to whole words when the first sentence is under the field's minimum", () => {
    const t = "Ra. The sun god Ra crossed the sky each day in a boat and sailed the underworld each night";
    const out = trimToLimit(t, 50, 20)!;
    expect(out).toBe("Ra. The sun god Ra crossed the sky each day in a…");
    expect(out.length).toBeLessThanOrEqual(50);
  });
  it("returns null rather than cut inside a word or go under the minimum", () => {
    expect(trimToLimit("Antidisestablishmentarianism", 10)).toBeNull();
    expect(trimToLimit("A b c d e f g h i j k l m n o p", 10, 12)).toBeNull();
  });
});

describe("trimOverlongStrings", () => {
  it("walks objects and arrays and reports each changed path", () => {
    const schema = { type: "object", properties: { xs: { type: "array", items: { type: "object", properties: { s: { type: "string", maxLength: 12 } } } } } };
    const out = trimOverlongStrings({ xs: [{ s: "Fine." }, { s: "One. Two three four." }] }, schema)!;
    expect(out.value).toEqual({ xs: [{ s: "Fine." }, { s: "One." }] });
    expect(out.trimmed).toEqual([{ path: "$.xs[1].s", from: 20, to: 4 }]);
  });
});
