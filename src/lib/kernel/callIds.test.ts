import { describe, it, expect, vi } from "vitest";

// #262: the ids TutorEngine.run gives tool calls reach Anthropic as tool_use and tool_result ids, which
// must be [a-zA-Z0-9_-]. One turn through the real kernel. The model call is the only stand-in: the
// first call asks for a tool, the second records the history the kernel sends back.

type Msg = { role: string; content: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string };
const sent: Msg[][] = [];

vi.mock("../llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm")>()),
  callLLMTurn: vi.fn(async function* (messages: Msg[]) {
    sent.push(messages.map((m) => ({ ...m })));
    if (sent.length === 1) {
      yield { type: "tool_call" as const, id: "toolu_01Ab", name: "notebook.search", args: { query: "cells" } };
      yield { type: "done" as const, finishReason: "tool_calls" as const };
    } else {
      yield { type: "text" as const, delta: "Your notes say cells are small." };
      yield { type: "done" as const, finishReason: "stop" as const };
    }
  }),
}));

import { tutorEngine } from "./TutorEngine";
import { chatTurnSkills } from "./chatSkills";
import type { LLMConfig } from "../../types";

const CONFIG = { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "test" } as unknown as LLMConfig;
const { activeSkill, domainSkill } = chatTurnSkills("explain", "Biology", "large", false);

describe("tool-call ids from TutorEngine.run (#262)", () => {
  it("are cloud-safe in the assistant turn and the tool result it sends back", async () => {
    await tutorEngine.run(
      { messages: [{ role: "system", content: "You are a tutor." }, { role: "user", content: "What did my notes say about cells?" }], config: CONFIG, retrieval: "off", onText: () => {} },
      {
        courseId: "c-1", level: 1, syllabus: null, modelTier: "large", contextTokens: 8192, permissionMode: "default", config: CONFIG,
        abort: new AbortController().signal, activeSkill, domainSkill, supportsTools: true,
      },
    );
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const second = sent[1];
    const ids = [
      ...second.flatMap((m) => m.tool_calls?.map((c) => c.id) ?? []),
      ...second.flatMap((m) => (m.tool_call_id ? [m.tool_call_id] : [])),
    ];
    expect(ids.length).toBeGreaterThanOrEqual(2); // the call and its result
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]{1,40}$/);
  });
});
