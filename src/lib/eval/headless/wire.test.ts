import { describe, it, expect, afterEach } from "vitest";
import { installWire } from "./wire";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

describe("installWire", () => {
  it("does nothing when neither option is set", () => {
    const before = globalThis.fetch;
    installWire({ log: false });
    expect(globalThis.fetch).toBe(before);
  });

  it("adds num_gpu to chat and embed requests and logs Ollama's own counts for chat", async () => {
    const seen: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(
        `${JSON.stringify({ message: { content: "hi" } })}\n${JSON.stringify({ done: true, load_duration: 2_000_000_000, prompt_eval_count: 41, prompt_eval_duration: 5e8, eval_count: 7, eval_duration: 1e8 })}\n`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const wire = installWire({ log: true, numGpu: 0 });
    await (await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "q?" }, { role: "user", content: "rewrite" }], format: {}, options: { num_ctx: 8192 } }) })).text();
    await (await fetch("http://127.0.0.1:11434/api/embed", { method: "POST", body: JSON.stringify({ input: ["x"] }) })).text();
    await wire.settle();
    expect(seen[0].options).toEqual({ num_ctx: 8192, num_gpu: 0 });
    expect(seen[1].options).toEqual({ num_gpu: 0 });
    expect(wire.calls).toHaveLength(1);
    expect(wire.calls[0]).toMatchObject({ kind: "structured", ask: "q?", loadMs: 2000, promptEvalCount: 41, promptEvalMs: 500, evalCount: 7, evalMs: 100 });
  });
});
