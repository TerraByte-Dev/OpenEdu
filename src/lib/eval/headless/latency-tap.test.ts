import { describe, it, expect, afterEach } from "vitest";
import { installTap } from "./latency-tap";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ND = (objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
const FINAL = { done: true, done_reason: "stop", load_duration: 2_500_000_000, prompt_eval_count: 812, prompt_eval_duration: 8_120_000_000, eval_count: 64, eval_duration: 3_200_000_000 };

describe("installTap", () => {
  it("records Ollama's final timing fields per request, under the label set when it was sent, and leaves the request alone", async () => {
    const seen: Array<{ url: string; body: string | undefined }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(String(init!.body)) as { format?: unknown };
        return new Response(body.format
          ? JSON.stringify({ message: { content: "{}" }, ...FINAL, eval_count: 9 })
          : ND([{ message: { content: "Hel" } }, { message: { content: "lo" } }, FINAL]));
      }
      if (url.endsWith("/api/embed")) return new Response(JSON.stringify({ embeddings: [[1, 0]], total_duration: 90_000_000, load_duration: 40_000_000, prompt_eval_count: 5 }));
      return new Response("[]");
    }) as typeof fetch;

    const tap = installTap();
    tap.label = "notes-hi-gloss#2";
    const chatBody = JSON.stringify({ model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: "the question" }] });
    const res = await fetch("http://127.0.0.1:11435/api/chat", { method: "POST", body: chatBody });
    expect(await res.text()).toBe(ND([{ message: { content: "Hel" } }, { message: { content: "lo" } }, FINAL])); // the caller still reads the whole body
    const structured = JSON.stringify({ model: "m", format: {}, stream: false, messages: [{ role: "user", content: "the question" }, { role: "user", content: "instruction" }] });
    await (await fetch("http://127.0.0.1:11435/api/chat", { method: "POST", body: structured })).json();
    await (await fetch("http://127.0.0.1:11435/api/embed", { method: "POST", body: JSON.stringify({ model: "e", input: ["the question"] }) })).json();
    tap.label = null;
    await (await fetch("/library/index.json")).text(); // app-origin and other paths pass through unrecorded
    await (await fetch("http://127.0.0.1:11435/api/ps")).text();
    await tap.settle();

    expect(seen.map((s) => s.body)).toEqual([chatBody, structured, JSON.stringify({ model: "e", input: ["the question"] }), undefined, undefined]);
    expect(tap.calls).toHaveLength(3);
    const [chat, gloss, embed] = tap.calls;
    expect(chat).toMatchObject({ seq: 0, label: "notes-hi-gloss#2", path: "/api/chat", kind: "turn", ask: "the question", inputs: [], status: 200, loadMs: 2_500, promptEvalCount: 812, promptEvalMs: 8_120, evalCount: 64, evalMs: 3_200 });
    expect(chat.firstByteMs).toEqual(expect.any(Number));
    expect(chat.ms).toBeGreaterThanOrEqual(chat.firstByteMs!);
    expect(gloss).toMatchObject({ kind: "structured", ask: "the question", evalCount: 9 });
    expect(embed).toMatchObject({ kind: "embed", ask: "", inputs: ["the question"], loadMs: 40, promptEvalCount: 5, evalMs: null });

    tap.uninstall();
    await (await fetch("http://127.0.0.1:11435/api/chat", { method: "POST", body: chatBody })).text();
    expect(tap.calls).toHaveLength(3);
  });

  it("gives the driver the fetch underneath it, unrecorded", async () => {
    globalThis.fetch = (async () => new Response("{}")) as typeof fetch;
    const tap = installTap();
    await tap.rawFetch("http://127.0.0.1:11435/api/embed", { method: "POST", body: "{}" });
    expect(tap.calls).toHaveLength(0);
    tap.uninstall();
  });
});
