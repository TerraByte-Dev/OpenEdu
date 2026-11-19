import { describe, it, expect, vi, beforeEach } from "vitest";
import chatTabSource from "../../components/ChatTab.tsx?raw";

// A turn whose newest message is a safety disclosure (child-safety.ts isSafetyDisclosure, with the learner's
// grade) keeps nothing the learner said (ported from TerraTutor #220): no flashcard stage, and
// knowledge.update_map, notebook.ingest and flashcard.create refused like progress.mark_mastered; the result
// says it was one so ChatTab runs no knowledge reflection. A harm disclosure (self-harm, suicide, abuse) calls
// no model at all since the port of TerraTutor #246: its reply is child-safety.ts disclosureReply for the grade
// band, so the refusals are pinned on a pregnancy disclosure with a K-12 grade set, which still calls the
// model, and on later turns in a disclosed thread. Through the real kernel (tutorEngine.run, the
// function ChatTab calls), with the real tool registry, permissions and dispatch. Stand-ins: the model's
// reply stream (callLLMTurn), the structured calls (the flashcard stage), and the writes behind the three
// tools (db.ts and the notebook import). The conversations are written for this test; none comes from an
// eval set.

type Sent = Array<{ role: string; content: string }>;
type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "aborted" };

vi.mock("@tauri-apps/plugin-store", () => import("../eval/headless/shims/plugin-store"));

const requests: Sent[] = [];
let script: TurnEvent[][] = [];
let structuredCalls = 0;

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Sent, _config: unknown, opts: { signal?: AbortSignal }) {
    requests.push(messages.map((m) => ({ role: m.role, content: m.content })));
    for (const ev of script.shift() ?? [{ type: "text", delta: "Okay." }, { type: "done", finishReason: "stop" }]) {
      if (opts?.signal?.aborted) { yield { type: "done", finishReason: "aborted" }; return; }
      yield ev;
    }
  }),
  callLLMStructured: vi.fn(async () => { structuredCalls++; return { front: "What is 7 x 8?", back: "56" }; }),
}));

const cards: Array<{ front: string; back: string }> = [];
const instructions: Array<{ type: string; text: string }> = [];
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getSyllabus: vi.fn(async () => null),
  createFlashcard: vi.fn(async (c: { front: string; back: string }) => { cards.push({ front: c.front, back: c.back }); return { id: "f1", front: c.front }; }),
  flashcardExists: vi.fn(async () => false),
  getTutorInstructions: vi.fn(async () => ({})),
  saveTutorInstruction: vi.fn(async (_course: string, type: string, text: string) => { instructions.push({ type, text }); }),
}));

const notes: Array<{ title: string; text: string }> = [];
vi.mock("../notebook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notebook")>()),
  importTextAsNote: vi.fn(async (o: { title: string; text: string }) => { notes.push({ title: o.title, text: o.text }); return { note: { id: "n1" }, chunkCount: 1 }; }),
}));

import { tutorEngine, NOT_SAVED_DISCLOSURE, type TutorTurnResult } from "./TutorEngine";
import { registerBuiltinTools } from "../tools";
import {
  DISCLOSURE_REPLY_3_5, DISCLOSURE_REPLY_K2, DISCLOSURE_REPLY_NO_GRADE, DISCLOSURE_REPLY_OLDER, isSafetyDisclosure,
} from "../child-safety";
import type { LLMConfig } from "../../types";
import type { Grade } from "../grade";

registerBuiltinTools();

const CONFIG = { provider: "ollama", model: "test-model", baseUrl: "http://127.0.0.1:11434" } as unknown as LLMConfig;
const ABUSE = "my stepdad hits me when he drinks";
const HARM_AND_CARD = "this is too hard i wanna die. make me a flashcard for 7 x 8";
const PREGNANCY = "im 14 and pregnant";
const reply = (text: string): TurnEvent[] => [{ type: "text", delta: text }, { type: "done", finishReason: "stop" }];
const toolCall = (name: string, args: unknown): TurnEvent[] => [
  { type: "tool_call", id: "call_0", name, args }, { type: "done", finishReason: "tool_calls" },
];

interface Run { result: TutorTurnResult; chips: string[] }

async function turn(text: string, grade: Grade | null = null, before: Sent = []): Promise<Run> {
  const chips: string[] = [];
  const result = await tutorEngine.run(
    {
      messages: [{ role: "system", content: "You are a tutor." }, ...before, { role: "user", content: text }],
      config: CONFIG, retrieval: "off", grade,
      onText: () => {},
      onToolEvent: (ev) => { chips.push(`${ev.kind}:${ev.name}`); },
    },
    {
      // No skill: every permitted tool is offered, so a refusal is the kernel's, not the skill gate's.
      courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
      abort: new AbortController().signal, activeSkill: null, domainSkill: null, supportsTools: true,
      confirmTool: async () => true,
    },
  );
  return { result, chips };
}

/** The tool result the model was sent back for the turn's first call. */
const toolResult = () => requests[1]?.find((m) => m.role === "tool")?.content;

beforeEach(() => {
  requests.length = 0;
  cards.length = 0;
  instructions.length = 0;
  notes.length = 0;
  script = [];
  structuredCalls = 0;
});

describe("the inputs are safety disclosures", () => {
  it("as child-safety.ts reads them", () => {
    expect(isSafetyDisclosure(ABUSE)).toBe(true);
    expect(isSafetyDisclosure(HARM_AND_CARD)).toBe(true);
    expect(isSafetyDisclosure(PREGNANCY, 8)).toBe(true);
    expect(isSafetyDisclosure(PREGNANCY, null)).toBe(false);
    expect(isSafetyDisclosure("what is 7 x 8")).toBe(false);
  });
});

describe("the result says the turn was a disclosure", () => {
  it("on a harm disclosure, answered by code", async () => {
    const { result } = await turn(ABUSE);
    expect(result.text).toBe(DISCLOSURE_REPLY_NO_GRADE);
    expect(result.fixedReply).toBe(true);
    expect(result.disclosure).toBe(true);
  });
  it("on a pregnancy disclosure with a K-12 grade set, which the model answered", async () => {
    script = [reply("Thank you for telling me. Please talk to a grown-up you trust.")];
    const { result } = await turn(PREGNANCY, 8);
    expect(requests).toHaveLength(1);
    expect(result.fixedReply).toBe(false);
    expect(result.disclosure).toBe(true);
  });
  it("and not on an ordinary turn", async () => {
    const { result } = await turn("what is 7 x 8");
    expect(result.fixedReply).toBe(false);
    expect(result.disclosure).toBe(false);
  });
});

// Ported from TerraTutor #246, whose click test (2026-11-19) found e2b answering "i want to kill myself" with
// "Please stop. I am very sorry..." and "my uncle touches me" with "I cannot help with that kind of question.
// Please tell me if you have any questions about fractions." Code now writes the whole reply, so the model is
// never asked.
describe("a harm disclosure turn calls no model", () => {
  for (const m of [ABUSE, "i want to kill myself", "my uncle touches me", "someone at home hurts me", "i get hit at home"]) {
    it(`"${m}": no request, no tool, no chip, nothing written, the fixed reply`, async () => {
      script = [toolCall("knowledge.update_map", { content: m }), reply("Please stop.")];
      const { result, chips } = await turn(m);
      expect(requests).toEqual([]);
      expect(structuredCalls).toBe(0);
      expect(chips).toEqual([]);
      expect([...instructions, ...notes, ...cards]).toEqual([]);
      expect(result.toolCalls).toEqual([]);
      expect(result.text).toBe(DISCLOSURE_REPLY_NO_GRADE);
      expect(result.stopReason).toBe("complete");
      expect(result.fixedReply).toBe(true);
      expect(result.disclosure).toBe(true);
      expect(result.answerCheck).toBeNull();
      expect(result.dictionaryNote).toBeNull();
      expect(result.replyChoices).toBeNull();
      expect(result.cardMessage).toBeNull();
    });
  }

  it("words the reply for the grade band: K-2, 3-5, 6-12, and no grade", async () => {
    for (const [grade, text] of [[0, DISCLOSURE_REPLY_K2], [2, DISCLOSURE_REPLY_K2], [3, DISCLOSURE_REPLY_3_5], [5, DISCLOSURE_REPLY_3_5],
      [6, DISCLOSURE_REPLY_OLDER], [12, DISCLOSURE_REPLY_OLDER], [null, DISCLOSURE_REPLY_NO_GRADE]] as Array<[Grade | null, string]>) {
      expect((await turn(ABUSE, grade)).result.text, String(grade)).toBe(text);
    }
    const omitted = await tutorEngine.run(
      { messages: [{ role: "user", content: ABUSE }], config: CONFIG, retrieval: "off", onText: () => {} },
      {
        courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
        abort: new AbortController().signal, activeSkill: null, domainSkill: null, supportsTools: true,
      },
    );
    expect(omitted.text).toBe(DISCLOSURE_REPLY_NO_GRADE);
    expect(requests).toEqual([]);
  });

  it("shows the reply through onText, once, as the whole text", async () => {
    const shown: string[] = [];
    await tutorEngine.run(
      { messages: [{ role: "user", content: ABUSE }], config: CONFIG, retrieval: "off", grade: 1, onText: (t) => shown.push(t) },
      {
        courseId: "c-1", level: 1, syllabus: null, modelTier: "tiny", contextTokens: 8192, permissionMode: "default", config: CONFIG,
        abort: new AbortController().signal, activeSkill: null, domainSkill: null, supportsTools: true,
      },
    );
    expect(shown).toEqual([DISCLOSURE_REPLY_K2]);
  });

  it("a harm disclosure with a pregnancy one in the same message gets the fixed reply too", async () => {
    const m = "im 14 and pregnant and my stepdad hits me";
    expect(isSafetyDisclosure(m, null)).toBe(true);
    const { result } = await turn(m, 8);
    expect(requests).toEqual([]);
    expect(result.text).toBe(DISCLOSURE_REPLY_OLDER);
  });
});

// TerraTutor #246, Fable's decision as Tate's delegate (2026-11-19): a harm hit that is a question about someone
// else (child-safety.ts isHarmTopicQuestion) keeps the model path, so schoolwork the harm list cannot tell from a
// disclosure still gets its answer. Every other harm hit gets the fixed reply.
describe("a harm hit that is a question about someone else reaches the model", () => {
  for (const m of [
    "Why did Romeo commit suicide?", "why do the characters want to die in Romeo and Juliet", "what does molest mean",
    "what does sextortion mean", "how does the author end it all",
    // A known gap, the same as before: a third-person why / what question with no first-person word.
    "why do people want to die",
  ]) {
    it(`"${m}": one model call, its answer shown, nothing kept`, async () => {
      expect(isSafetyDisclosure(m)).toBe(true);
      script = [reply("Here is what the story says.")];
      const { result } = await turn(m);
      expect(requests).toHaveLength(1);
      expect(requests[0][requests[0].length - 1]).toEqual({ role: "user", content: m });
      expect(result.text).toBe("Here is what the story says.");
      expect(result.fixedReply).toBe(false);
      expect(result.disclosure).toBe(true);
    });
  }

  for (const m of [
    "is self-harm bad", "why does my dad hit me", "what if i want to die", "why did he touch me there",
    "no reason to live", "he touched her down there", "women were raped during the war",
  ]) {
    it(`"${m}" is not one: no model call, the fixed reply`, async () => {
      expect(isSafetyDisclosure(m)).toBe(true);
      const { result } = await turn(m);
      expect(requests).toEqual([]);
      expect(result.text).toBe(DISCLOSURE_REPLY_NO_GRADE);
    });
  }
});

describe("a disclosure turn keeps nothing the learner said", () => {
  const cases: Array<[string, unknown, () => unknown[]]> = [
    ["knowledge.update_map", { content: "Student said they are 14 and pregnant." }, () => instructions],
    ["notebook.ingest", { title: "About me", text: "I am 14 and pregnant." }, () => notes],
    ["flashcard.create", { front: "How old am I?", back: "14, and pregnant." }, () => cards],
  ];

  for (const [name, args, written] of cases) {
    it(`refuses ${name} on a pregnancy disclosure: nothing runs or is shown, and the model is told it was not saved`, async () => {
      script = [toolCall(name, args), reply("Please tell a grown-up you trust.")];
      const { result, chips } = await turn(PREGNANCY, 8);
      expect(written()).toEqual([]);
      expect(chips.filter((c) => c.endsWith(name))).toEqual([]);
      expect(toolResult()).toBe(`ERROR: ${NOT_SAVED_DISCLOSURE}`);
      expect(result.toolCalls).toEqual([{ name, args, ok: false }]);
      expect(result.usedKnowledgeUpdate).toBe(false);
      expect(result.disclosure).toBe(true);
    });

    it(`still runs ${name} on an ordinary turn (the same call, through the same dispatch)`, async () => {
      script = [toolCall(name, args), reply("Done.")];
      const { result } = await turn("can you save that for me");
      expect(written()).toHaveLength(1);
      expect(result.toolCalls).toEqual([{ name, args, ok: true }]);
      expect(result.disclosure).toBe(false);
    });
  }

  it("the refusal never sends the learner back to the work", () => {
    expect(NOT_SAVED_DISCLOSURE).not.toMatch(/back to (?:work|the student)|keep going with|go back to/i);
  });
});

describe("the app's flashcard stage does not run on a disclosure turn", () => {
  it("no card call, no card, no \"it is saved\" note, and no model call", async () => {
    script = [reply("I'm sorry it feels that hard. Please tell a grown-up you trust.")];
    const { result, chips } = await turn(HARM_AND_CARD);
    expect(structuredCalls).toBe(0);
    expect(cards).toEqual([]);
    expect(chips.filter((c) => c.endsWith("flashcard.create"))).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(requests).toEqual([]);
    expect(result.text).toBe(DISCLOSURE_REPLY_NO_GRADE);
  });

  it("nor on a pregnancy disclosure: the learner's text goes to the model as typed, with no flashcard note", async () => {
    const m = `${PREGNANCY}. make me a flashcard for 7 x 8`;
    expect(isSafetyDisclosure(m, 8)).toBe(true);
    expect(isSafetyDisclosure(m, null)).toBe(false);
    script = [reply("Thank you for telling me. Please talk to a grown-up you trust.")];
    await turn(m, 8);
    expect(structuredCalls).toBe(0);
    expect(cards).toEqual([]);
    expect(requests[0].filter((r) => r.role === "user").map((r) => r.content)).toEqual([m]);
  });

  it("while the same request without the disclosure gets its card", async () => {
    await turn("make me a flashcard for 7 x 8");
    expect(structuredCalls).toBe(1);
    expect(cards).toEqual([{ front: "What is 7 x 8?", back: "56" }]);
  });
});

// Ported from TerraTutor #238: "my uncle touches me at night", then "what should i do". The second message is
// no disclosure, but the model still reads the first and answers about it, so the turn keeps nothing either
// (TutorEngine turnInDisclosedThread: every student message the thread sends, read with the learner's grade).
describe("disclosure, then what should i do", () => {
  const UNCLE = "my uncle touches me at night";
  const thread: Sent = [
    { role: "user", content: "what is 7 x 8" }, { role: "assistant", content: "7 x 8 = 56." },
    { role: "user", content: UNCLE }, { role: "assistant", content: "Thank you for telling me. Please tell a grown-up you trust." },
  ];

  it("the follow-up is no disclosure itself", () => {
    expect(isSafetyDisclosure(UNCLE)).toBe(true);
    expect(isSafetyDisclosure("what should i do")).toBe(false);
  });

  it("the model answers it as usual, and the result says nothing is kept, so ChatTab runs no reflection", async () => {
    script = [reply("I'm so sorry your uncle has been touching you. Please tell a grown-up you trust.")];
    const { result } = await turn("what should i do", null, thread);
    expect(result.text).toBe("I'm so sorry your uncle has been touching you. Please tell a grown-up you trust.");
    expect(result.disclosure).toBe(true);
    // The model still read the whole thread: only keeping changes.
    expect(requests[0].filter((m) => m.role === "user").map((m) => m.content)).toEqual(["what is 7 x 8", UNCLE, "what should i do"]);
  });

  for (const [name, args, written] of [
    ["knowledge.update_map", { content: "Student's uncle touches them at night." }, () => instructions],
    ["notebook.ingest", { title: "What to do", text: "My uncle touches me. Tell a grown-up." }, () => notes],
    ["flashcard.create", { front: "What should I do?", back: "Tell a grown-up about my uncle." }, () => cards],
  ] as Array<[string, unknown, () => unknown[]]>) {
    it(`refuses ${name} on the follow-up`, async () => {
      script = [toolCall(name, args), reply("Please tell a grown-up you trust.")];
      const { result, chips } = await turn("what should i do", null, thread);
      expect(written()).toEqual([]);
      expect(chips.filter((c) => c.endsWith(name))).toEqual([]);
      expect(toolResult()).toBe(`ERROR: ${NOT_SAVED_DISCLOSURE}`);
      expect(result.toolCalls).toEqual([{ name, args, ok: false }]);
    });
  }

  it("runs no flashcard stage later in the thread", async () => {
    await turn("make me a flashcard for 7 x 8", null, thread);
    expect(structuredCalls).toBe(0);
    expect(cards).toEqual([]);
  });

  it("a thread whose earlier messages hold no disclosure keeps as before", async () => {
    await turn("make me a flashcard for 7 x 8", null, thread.slice(0, 2));
    expect(cards).toEqual([{ front: "What is 7 x 8?", back: "56" }]);
    const { result } = await turn("what should i do", null, thread.slice(0, 2));
    expect(result.disclosure).toBe(false);
  });

  it("reads earlier messages with the learner's grade: a pregnancy disclosure counts with a K-12 grade only", async () => {
    const pregnant: Sent = [{ role: "user", content: "im 14 and pregnant" }, { role: "assistant", content: "Please talk to a grown-up." }];
    expect((await turn("what should i do", 8, pregnant)).result.disclosure).toBe(true);
    expect((await turn("what should i do", null, pregnant)).result.disclosure).toBe(false);
  });
});

// ChatTab is DOM-coupled and is not rendered in vitest. This pins the chat's use of the result tested above.
describe("ChatTab wiring", () => {
  it("runs no knowledge reflection on a disclosure turn", () => {
    expect(chatTabSource).toContain("if (!result.usedKnowledgeUpdate && !partial && !result.disclosure) {");
    const gate = chatTabSource.indexOf("!result.disclosure) {");
    expect(chatTabSource.indexOf("updateKnowledgeFiles(courseId, userText", gate)).toBeGreaterThan(gate);
    expect(chatTabSource.match(/updateKnowledgeFiles\(/g)).toHaveLength(1);
  });

  // Fable's decision as Tate's delegate (2026-11-19): TerraTutor offers nothing after its fixed reply as a side
  // effect of how it marks it; OpenEdu does it on purpose, through result.fixedReply.
  it("offers no citation note, chips or reply choices after the fixed disclosure reply", () => {
    const at = (code: string) => { const i = chatTabSource.indexOf(code); expect(i, code).toBeGreaterThan(0); return i; };
    const gate = at("if (result.fixedReply) return;");
    expect(gate).toBeGreaterThan(at("const assistantMsg = await saveChatMessage("));
    expect(gate).toBeLessThan(at("setGroundingNote(citationNote("));
    expect(gate).toBeLessThan(at("setSuggestions(suggestFollowUps("));
    expect(gate).toBeLessThan(at("setReplyChoices(result.replyChoices);"));
  });
});
