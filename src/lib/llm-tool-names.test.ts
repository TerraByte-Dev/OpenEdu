import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #262: Anthropic and OpenAI accept only [a-zA-Z0-9_-] in a tool name and answer 400 otherwise, and
// OpenEdu's tool names have a dot ("notebook.search"). These run the real callLLMTurn against a stubbed
// fetch: the request each provider is sent, and the tool call the kernel gets back. Ollama keeps dots.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMTurn, cloudToolName, localToolName, type LLMTurnEvent, type NeutralMessage, type ProviderToolDef } from "./llm";
import type { LLMConfig } from "../types";
import { kernelCallId } from "./kernel/TutorEngine";

const TOOLS: ProviderToolDef[] = [
  { name: "notebook.search", description: "Search notes", parameters: { type: "object", properties: { q: { type: "string" } } } },
  { name: "progress.mark_mastered", description: "Mark a skill", parameters: { type: "object", properties: {} } },
];
// A history with an earlier tool call, so the assistant turn's tool name is on the wire too.
const HISTORY: NeutralMessage[] = [
  { role: "user", content: "what did my notes say?" },
  { role: "assistant", content: "", tool_calls: [{ id: kernelCallId(1, "toolu_01Ab"), name: "notebook.search", args: { q: "cells" } }] },
  { role: "tool", tool_call_id: kernelCallId(1, "toolu_01Ab"), name: "notebook.search", content: "Cells are small." },
  { role: "user", content: "and again?" },
];
const WIRE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
let bodies: Array<Record<string, unknown>> = [];
const original = globalThis.fetch;

beforeEach(() => {
  bodies = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (url.includes("anthropic.com")) {
      return new Response(sse([
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "notebook__search" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":\"cells\"}" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ]), { status: 200 });
    }
    if (url.includes("openai.com")) {
      return new Response(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "notebook__search", arguments: "{\"q\":\"cells\"}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]), { status: 200 });
    }
    // Ollama: newline-delimited JSON, one final message.
    return new Response(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true }) + "\n", { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = original; });

const config = (provider: string, model: string): LLMConfig =>
  ({ provider, model, apiKey: "test-key", ollamaUrl: "http://127.0.0.1:11434" }) as LLMConfig;

async function turn(c: LLMConfig): Promise<LLMTurnEvent[]> {
  const out: LLMTurnEvent[] = [];
  for await (const ev of callLLMTurn(HISTORY, c, { tools: TOOLS })) out.push(ev);
  return out;
}

describe("tool names on the cloud wire (#262)", () => {
  it("maps a dotted name to a cloud-safe one and back, only for tools that were offered", () => {
    expect(cloudToolName("progress.mark_mastered")).toBe("progress__mark_mastered");
    expect(localToolName("progress__mark_mastered", TOOLS)).toBe("progress.mark_mastered");
    expect(localToolName("made_up__tool", TOOLS)).toBe("made_up__tool"); // left for dispatch to refuse
  });

  it("sends Anthropic only cloud-safe names, in the tool list and in history, and returns the real name", async () => {
    const events = await turn(config("anthropic", "claude-haiku-5-5"));
    const body = bodies[0] as { tools: Array<{ name: string }>; messages: Array<{ content: unknown }> };
    expect(body.tools.map((t) => t.name)).toEqual(["notebook__search", "progress__mark_mastered"]);
    const wire = JSON.stringify(body.messages);
    expect(wire).toContain("\"name\":\"notebook__search\"");
    expect(wire).not.toContain("notebook.search");
    for (const t of body.tools) expect(t.name).toMatch(WIRE_NAME);
    // The kernel's tool-call ids reach Anthropic as tool_use ids and tool_result ids; same character rule.
    for (const m of wire.matchAll(/"(?:id|tool_use_id)":"([^"]*)"/g)) expect(m[1]).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "notebook.search", args: { q: "cells" } });
  });

  it("sends OpenAI only cloud-safe names, in the tool list and in history, and returns the real name", async () => {
    const events = await turn(config("openai", "gpt-6.1-sol"));
    const body = bodies[0] as { tools: Array<{ function: { name: string } }>; messages: unknown[] };
    expect(body.tools.map((t) => t.function.name)).toEqual(["notebook__search", "progress__mark_mastered"]);
    expect(JSON.stringify(body.messages)).not.toContain("notebook.search");
    // tool_calls[].id and tool_call_id: same characters, and OpenAI caps them at 40.
    for (const m of JSON.stringify(body.messages).matchAll(/"(?:id|tool_call_id)":"([^"]*)"/g)) expect(m[1]).toMatch(/^[a-zA-Z0-9_-]{1,40}$/);
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "notebook.search", args: { q: "cells" } });
  });

  it("leaves Ollama's request exactly as before: dotted names", async () => {
    await turn(config("ollama", "gemma4:e2b"));
    const body = bodies[bodies.length - 1] as { tools: Array<{ function: { name: string } }> };
    expect(body.tools.map((t) => t.function.name)).toEqual(["notebook.search", "progress.mark_mastered"]);
  });
});
