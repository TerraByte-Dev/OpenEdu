import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ollama stopped, or the tutor's model gone from it, through the functions the app calls: quiz.ts
// generateQuizQuestions / generatePromotionTestQuestions (QuizFullScreen, PromotionTestFullScreen),
// curriculum.ts generateSyllabus (the course build), llm.ts callLLMStructured and callLLMTurn (the chat).
// llm.ts is the real one; its fetch goes through the headless plugin-http shim to the stub below, which
// plays Ollama answering, refusing every connection the way the real plugin does (reqwest's bare
// string), or answering 404 for a model it doesn't have. Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));
vi.mock("@tauri-apps/plugin-sql", () => import("./eval/headless/shims/plugin-sql"));

const saved: unknown[] = [];
let stored: Record<string, string> = {};
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getTutorInstruction: vi.fn(async (_c: string, key: string) => stored[key] ?? null),
  saveTutorInstruction: vi.fn(async () => {}),
  saveSyllabus: vi.fn(async (s: unknown) => { saved.push(s); }),
  updateGenerationState: vi.fn(async () => {}),
}));

import { generateQuizQuestions, generatePromotionTestQuestions } from "./quiz";
import { generateSyllabus } from "./curriculum";
import { callLLMStructured, callLLMTurn, type LLMTurnEvent } from "./llm";
import { friendlyError } from "./plain-language";
import { persistedReply } from "./kernel/persistedReply";
import type { LLMConfig, QuizQuestion, Syllabus } from "../types";

const NOT_RUNNING = "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.";
const REFUSED = "error sending request for url (http://127.0.0.1:11434/api/chat)";

// A tiny model that is not one of the defaults, so the quiz runs no verify pass (runsVerifyPass).
const LOCAL = { provider: "ollama", model: "tiny-test:1b", ollamaUrl: "http://127.0.0.1:11434", modelTier: "tiny" } as unknown as LLMConfig;
const SYLLABUS = (level: number) => ({
  level, title: "Animals",
  subtopics: [{ id: `${level}.1`, title: "Animal homes", key_concepts: ["nests", "dens"], practice_type: "discussion", mastered: false }],
}) as unknown as Syllabus;

const STEMS = [
  "Birds build nests from twigs and grass.", "A fox sleeps in an underground den.", "Honeybees store food inside a waxy hive.",
  "Beavers make lodges with sticks and mud in ponds.", "Rabbits dig burrows called warrens.", "Spiders spin silk webs to catch insects.",
  "Bats often rest upside down in caves.", "Owls may nest inside hollow tree trunks.",
];
let made = 0;
const question = (subtopic: string) => ({
  question_text: STEMS[made++ % STEMS.length], question_type: "true_false", options: ["True", "False"], correct_answer: "True",
  difficulty_level: 1, explanation: "Animals have homes. Therefore the answer is True.", subtopic_id: subtopic, blank_position: "", matching_pairs: [],
});

// What Ollama does with each /api/chat call, by count: "ok" answers, "down" refuses, "missing" is a 404.
type Mode = "ok" | "down" | "missing";
let chatMode: (n: number) => Mode = () => "down";
let versionUp = false;
let chatBodies: Array<Record<string, unknown>> = [];
let answer: (body: Record<string, unknown>) => unknown = (body) => question(/id="([^"]+)"/.exec(JSON.stringify(body.messages))?.[1] ?? "1.1");

const original = globalThis.fetch;
beforeEach(() => {
  made = 0;
  chatBodies = [];
  saved.length = 0;
  stored = {};
  versionUp = false;
  chatMode = () => "down";
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.endsWith("/api/version")) return versionUp ? Response.json({ version: "0.12.6" }) : Promise.reject(REFUSED);
    if (url.endsWith("/api/chat")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      chatBodies.push(body);
      const mode = chatMode(chatBodies.length);
      if (mode === "down") return Promise.reject(REFUSED);
      if (mode === "missing") return new Response(`{"error":"model '${LOCAL.model}' not found"}`, { status: 404 });
      return Response.json({ message: { content: JSON.stringify(answer(body)) }, done: true, done_reason: "stop" });
    }
    return Promise.reject(REFUSED); // /api/ps, /api/show: Ollama can't tell, so nothing is loaded first
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = original; });

async function failure(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error("expected it to fail");
}

describe("making a quiz while Ollama is stopped", () => {
  it("stops at the first question and shows the Ollama sentence, not 'couldn't put this together'", async () => {
    const e = await failure(generateQuizQuestions(SYLLABUS(1), 20, { ...LOCAL }));
    expect(chatBodies).toHaveLength(1);
    expect(friendlyError(e)).toBe(NOT_RUNNING);
  });

  it("with missed questions saved, still fails: no short review-only quiz starts", async () => {
    const pool: QuizQuestion[] = [0, 1, 2].map((i) => ({
      id: `q${i}`, attempt_id: "a1", question_text: STEMS[i], question_type: "true_false", options: ["True", "False"],
      correct_answer: "True", user_answer: "False", is_correct: false, difficulty_level: 1,
      explanation: "Animals have homes. Therefore the answer is True.", subtopic_id: "1.1",
    }));
    const e = await failure(generateQuizQuestions(SYLLABUS(1), 20, { ...LOCAL }, pool, undefined, null, null));
    expect(friendlyError(e)).toBe(NOT_RUNNING);
  });

  it("when the model is gone from Ollama, says so, and never to pick a more capable model", async () => {
    versionUp = true;
    chatMode = () => "missing";
    const e = await failure(generateQuizQuestions(SYLLABUS(1), 20, { ...LOCAL }));
    expect(chatBodies).toHaveLength(1);
    const shown = friendlyError(e, { model: LOCAL.model, provider: "ollama", ramBytes: 8 * 2 ** 30 });
    expect(shown).toContain(`The tutor's model (${LOCAL.model}) isn't on this computer yet.`);
    expect(shown).not.toMatch(/capable|couldn't put this together/);
  });

  it("a model that writes nothing usable still gets the old message (not mistaken for Ollama down)", async () => {
    versionUp = true;
    chatMode = () => "ok";
    answer = () => ({ nonsense: true });
    try {
      const e = await failure(generateQuizQuestions(SYLLABUS(1), 2, { ...LOCAL }));
      expect(friendlyError(e)).toMatch(/^The tutor couldn't put this together this time\. Try again\./);
    } finally {
      answer = (body) => question(/id="([^"]+)"/.exec(JSON.stringify(body.messages))?.[1] ?? "1.1");
    }
  });
});

describe("making a level test when Ollama stops partway", () => {
  it("stops at once and shows the Ollama sentence instead of a short test's 'more capable model'", async () => {
    versionUp = true;
    chatMode = (n) => (n <= 5 ? "ok" : "down");
    const e = await failure(generatePromotionTestQuestions(SYLLABUS(2), [SYLLABUS(1)], { ...LOCAL }));
    expect(chatBodies).toHaveLength(6);
    expect(friendlyError(e)).toBe(NOT_RUNNING);
  });
});

describe("the Ollama version probe", () => {
  const SCHEMA = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } };
  const config = { ...LOCAL, ollamaUrl: "http://127.0.0.1:11435" } as LLMConfig;

  it("is asked again after Ollama comes back, so structured calls keep the schema format", async () => {
    await expect(callLLMStructured([{ role: "user", content: "hi" }], config, { schema: SCHEMA })).rejects.toThrow(/Ollama/);
    versionUp = true;
    chatMode = () => "ok";
    answer = () => ({ ok: true });
    try {
      await callLLMStructured([{ role: "user", content: "hi" }], config, { schema: SCHEMA });
    } finally {
      answer = (body) => question(/id="([^"]+)"/.exec(JSON.stringify(body.messages))?.[1] ?? "1.1");
    }
    expect(chatBodies[chatBodies.length - 1].format).toEqual(SCHEMA);
  });
});

describe("a course build when Ollama stops on a level's last subtopic", () => {
  const outline = {
    levels: [1, 2, 3, 4, 5].map((level) => ({ level, title: `Level ${level}`, focus_areas: ["Homes", "Food"], key_outcomes: ["Name homes"], bridge: "next" })),
    mastery_exam: { domains: ["Homes"], synthesis_skills: ["Explain"], scenarios: ["A wood"] },
  };
  const topics = {
    level_title: "Animals, level 1", level_description: "Where animals live and what they eat, for young learners.",
    learning_objectives: ["Name animal homes", "Say what animals eat", "Tell a baby animal from its parent"],
    subtopics: [{ id: "1.1", title: "Animal homes" }, { id: "1.2", title: "What animals eat" }, { id: "1.3", title: "Baby animals" }],
    assessment_criteria: ["Student can name three homes", "Student can match a baby to its parent"], estimated_hours: 4,
  };
  const expansion = { key_concepts: ["nests", "dens"], practice_type: "discussion", objective: "Name where three animals live." };

  it("fails the level unsaved instead of saving a placeholder subtopic, so a resume writes it", async () => {
    stored = { course_outline_json: JSON.stringify(outline) };
    versionUp = true;
    chatMode = (n) => (n <= 3 ? "ok" : "down"); // the topic list and two expansions, then Ollama stops
    answer = (body) => (JSON.stringify(body.format).includes("practice_type") ? expansion : topics);
    try {
      const e = await failure(generateSyllabus("c1", "Animals", 1, { ...LOCAL, modelTier: "medium" } as LLMConfig, "brief"));
      expect(friendlyError(e)).toBe(NOT_RUNNING);
    } finally {
      answer = (body) => question(/id="([^"]+)"/.exec(JSON.stringify(body.messages))?.[1] ?? "1.1");
    }
    expect(chatBodies).toHaveLength(4);
    expect(saved).toEqual([]);
  });
});

describe("a tutor reply when Ollama quits mid-stream", () => {
  const CHAT = { ...LOCAL, ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
  // A 200 whose body sends `lines` and then breaks, as the plugin's stream does when Ollama goes away.
  const breaking = (lines: string[]) => {
    globalThis.fetch = (async (input: unknown) => {
      if (!String(input).endsWith("/api/chat")) return Promise.reject(REFUSED);
      let i = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (i < lines.length) ctrl.enqueue(new TextEncoder().encode(lines[i++] + "\n"));
          else ctrl.error(new Error("error decoding response body"));
        },
      }), { status: 200 });
    }) as unknown as typeof fetch;
  };
  const run = async () => {
    const events: LLMTurnEvent[] = [];
    for await (const ev of callLLMTurn([{ role: "user", content: "Why do birds build nests?" }], CHAT)) events.push(ev);
    return events;
  };

  it("keeps what was written: the turn ends as stalled and the reply is saved with its marker", async () => {
    breaking([JSON.stringify({ message: { content: "Birds build nests to keep " } }), JSON.stringify({ message: { content: "their eggs warm" } })]);
    const events = await run();
    expect(events[events.length - 1]).toEqual({ type: "done", finishReason: "stalled" });
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toBe("Birds build nests to keep their eggs warm");
    expect(persistedReply(text, "stalled")).toBe("Birds build nests to keep their eggs warm\n\n_[the tutor stopped responding — ask again to continue]_");
  });

  it("with nothing written yet, names Ollama instead of 'Something went wrong'", async () => {
    breaking([]);
    const e = await failure(run());
    expect(friendlyError(e)).toBe(NOT_RUNNING);
  });

  // The model runner crashes (out of memory on an 8 GB PC) while the server stays up: Ollama ends the 200
  // with an {"error": …} line instead of breaking the stream.
  const RUNNER_STOPPED = "model runner has unexpectedly stopped, this may be due to resource limitations or an internal error";
  const endsWithError = (lines: string[]) => {
    globalThis.fetch = (async (input: unknown) => {
      if (!String(input).endsWith("/api/chat")) return Promise.reject(REFUSED);
      return new Response([...lines, JSON.stringify({ error: RUNNER_STOPPED })].join("\n") + "\n", { status: 200 });
    }) as unknown as typeof fetch;
  };

  it("keeps what was written when the model runner crashes mid-reply: stalled, saved with its marker", async () => {
    endsWithError([JSON.stringify({ message: { content: "Birds build nests to keep " } }), JSON.stringify({ message: { content: "their eggs warm" } })]);
    const events = await run();
    expect(events[events.length - 1]).toEqual({ type: "done", finishReason: "stalled" });
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(persistedReply(text, "stalled")).toBe("Birds build nests to keep their eggs warm\n\n_[the tutor stopped responding — ask again to continue]_");
  });

  it("with nothing written yet, a crashed runner still fails the turn", async () => {
    endsWithError([]);
    const e = await failure(run());
    expect(String(e)).toContain(`Ollama error: ${RUNNER_STOPPED}`);
  });
});
