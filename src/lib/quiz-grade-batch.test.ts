import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Written answers on gemma4:e2b, the default local model below 14 GB of RAM. In B10 round 3 (TerraTutor
// src/lib/eval/results/2026-11-14-plus-bakeoff-r3.md) it marked 8 of 20 typed answers; the other 12 were
// passed as `fallback`. Replayed through this function the cause was the reply's shape, not a parse
// failure, a timeout or the prompt's length (about 450 tokens, done_reason "stop" every time): the schema
// let `results` be an array of any length, and in 3 of 5 batches e2b closed it after the first entry
// (32-37 tokens). The schema now names one verdict per answer, so Ollama's grammar cannot end the reply
// before every answer has one. This test runs the production path down to the request Ollama receives.

vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
vi.mock("@tauri-apps/plugin-store", () => import("./eval/headless/shims/plugin-store"));
vi.mock("@tauri-apps/api/core", () => import("./eval/headless/shims/api-core"));

import { gradeAnswersBatch } from "./quiz";
import type { LLMConfig } from "../types";

const MODEL = "gemma4:e2b";
const CONFIG = { provider: "ollama", model: MODEL, ollamaUrl: "http://127.0.0.1:11434", contextTokens: 8192 } as LLMConfig;
const original = globalThis.fetch;
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

type Schema = { type?: string; required?: string[]; additionalProperties?: boolean; properties?: Record<string, Schema> };

// An Ollama with e2b already loaded. `reply` answers each /api/chat request from its body.
function fakeOllama(reply: (body: { format: Schema; messages: Array<{ content: string }> }) => string) {
  const chats: Array<{ format: Schema; messages: Array<{ content: string }> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    switch (path) {
      case "/api/version": return json({ version: "0.40.16" });
      case "/api/tags": return json({ models: [{ name: MODEL }] });
      case "/api/show": return json({ details: { parameter_size: "5.1B" }, model_info: { "general.architecture": "gemma4", "gemma4.context_length": 131072 } });
      case "/api/ps": return json({ models: [{ name: MODEL, model: MODEL, context_length: 8192 }] });
      case "/api/chat":
        chats.push(body);
        return json({ message: { role: "assistant", content: reply(body) }, done: true, done_reason: "stop" });
      default: return new Response("not found", { status: 404 });
    }
  }) as typeof fetch;
  return chats;
}

// Four answers from round 3's b02 quiz, with the answer probe's typed text, at the caller's own indices.
const ANSWERS = [
  { index: 3, question: "If the minute hand is pointing directly at the 12 and the hour hand is pointing directly at the 3, what time is it?", expected: "C) 3:00", student: "I think it is TAXb02Q0TAX", type: "short_answer" },
  { index: 4, question: "If you have three pennies and one nickel, what is the total amount of money you have?", expected: "8 cents", student: "I think it is TAXb02Q1TAX", type: "fill_in_blank" },
  { index: 7, question: "If the short hand is pointing at the 5 and the long hand is pointing at the 12, what time is it?", expected: "C) 5:00", student: "five o clock", type: "short_answer" },
  { index: 9, question: "If the hour hand is exactly halfway between the 2 and the 3, what time is it?", expected: "B) 2:30", student: "I think it is TAXb02Q3TAX", type: "short_answer" },
];

describe("gradeAnswersBatch on a local model: one verdict per answer", () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { globalThis.fetch = original; });

  it("asks Ollama for a verdict on every answer by name, at e2b's tier, so the reply cannot stop after one", async () => {
    const chats = fakeOllama(() => JSON.stringify({}));
    await gradeAnswersBatch(ANSWERS, { ...CONFIG });
    const format = chats[0].format;
    const keys = ["answer_1", "answer_2", "answer_3", "answer_4"];
    expect(format.type).toBe("object");
    expect(format.additionalProperties).toBe(false);
    expect(format.required).toEqual(keys);
    expect(Object.keys(format.properties ?? {})).toEqual(keys);
    for (const k of keys) {
      // The reason comes before the verdict, so the verdict is written after the model has read the answer.
      expect(Object.keys(format.properties![k].properties ?? {})).toEqual(["feedback", "correct"]);
      expect(format.properties![k].required).toEqual(["feedback", "correct"]);
    }
    for (const a of ANSWERS) expect(chats[0].messages[0].content.split(a.student)).toHaveLength(2);
  });

  it("marks every answer from a reply that names them all, at the caller's indices", async () => {
    fakeOllama(() => JSON.stringify({
      answer_1: { feedback: "The student wrote a code, not a time.", correct: false },
      answer_2: { feedback: "No amount is given.", correct: false },
      answer_3: { feedback: "Five o'clock is 5:00.", correct: true },
      answer_4: { feedback: "No time is given.", correct: false },
    }));
    const out = await gradeAnswersBatch(ANSWERS, { ...CONFIG });
    expect([...out.entries()].map(([i, o]) => [i, o.isCorrect, o.by])).toEqual([
      [3, false, "model"], [4, false, "model"], [7, true, "model"], [9, false, "model"],
    ]);
    expect(out.get(7)?.feedback).toBe("Five o'clock is 5:00.");
  });

  it("asks again when a verdict is missing, and passes leniently as `fallback` only when it never comes", async () => {
    // Round 3's reply shape: one entry, then the array closed.
    const chats = fakeOllama(() => JSON.stringify({ answer_1: { feedback: "No time is given.", correct: false } }));
    const out = await gradeAnswersBatch(ANSWERS, { ...CONFIG });
    expect(chats.length).toBe(3); // the call and two repairs
    expect([...out.values()].every((o) => o.isCorrect && o.by === "fallback")).toBe(true);
  });

  it("tells the model to judge what the student wrote, not the expected answer", async () => {
    const chats = fakeOllama(() => JSON.stringify({}));
    await gradeAnswersBatch(ANSWERS, { ...CONFIG });
    const prompt = chats[0].messages[0].content;
    expect(prompt).toContain("Judge only what the student wrote");
    expect(prompt).not.toContain("generous");
  });
});

// Code marks an amount wrong only on a gross miss (answer-match.ts grossMiss). The fourth review's cases
// are a fact given as another fraction or as a fraction of a percent key, and a fall given with a minus
// sign: each is right, or close enough that the model decides, so none is marked wrong by code. With no
// local model the answers code leaves open pass as `fallback`.
const NEVER_CODE_WRONG: Array<[question: string, expected: string, student: string]> = [
  ["What fraction of Earth's surface is covered by water?", "7/10", "3/4"],
  ["What fraction of Earth's surface is covered by water?", "71/100", "3/4"],
  ["What fraction of Earth's surface is covered by water?", "about 7/10", "3/4"],
  ["What fraction of the air is nitrogen?", "4/5", "3/4"],
  ["What fraction of the air is nitrogen?", "78/100", "4/5"],
  ["What fraction of the human body is water?", "3/5", "2/3"],
  ["How much of Earth's surface is covered by water?", "70%", "3/4"],
  ["How much of Earth's surface is covered by water?", "71%", "3/4"],
  ["How much of the human body is water?", "60%", "2/3"],
  ["The temperature was 10 °C in the afternoon and 4 °C at night. How much did it go down?", "6 °C", "-6 °C"],
  ["It was 5 °C at noon and -3 °C at midnight. How much colder was it at midnight?", "8 °C", "-8 °C"],
  ["It was 5 °C at noon and -3 °C at midnight. How much did the temperature go down?", "8 degrees", "-8 degrees"],
  ["How much lower is -5 than 3?", "8", "-8"],
  // Verification of the fourth fix: more ways to ask for a decrease. A sign flip is now gross only on bare
  // arithmetic (signMatters), so no list of decrease words is needed.
  ["How much less is 3 than 10?", "7", "-7"],
  ["How many fewer apples does Ann have if she has 4 and Ben has 9?", "5", "-5"],
  ["How much smaller is 12 than 20?", "8", "-8"],
  ["The temperature cooled from 20 °C to 12 °C. By how much did it cool?", "8 °C", "-8 °C"],
  ["A balloon shrank from 30 cm to 22 cm. How much did it shrink?", "8 cm", "-8 cm"],
  ["Sales declined from 120 to 90. By how much did they decline?", "30", "-30"],
  ["Ann is 150 cm tall and Ben is 138 cm. How much shorter is Ben?", "12 cm", "-12 cm"],
  ["The temperature was 3 °C at 6 p.m. and -4 °C at 6 a.m. How much did it dip?", "7 °C", "-7 °C"],
  ["A car slowed from 60 mph to 45 mph. How much did it slow?", "15 mph", "-15 mph"],
];

describe("gradeAnswersBatch: code never marks wrong a near fact or the sign of a fall (the fourth review's cases)", () => {
  it.each(NEVER_CODE_WRONG)("%s %s / %s", async (question, expected, student) => {
    const out = await gradeAnswersBatch([{ index: 0, question, expected, student, type: "short_answer" }], null);
    expect(out.get(0)?.isCorrect).toBe(true);
  });
});
