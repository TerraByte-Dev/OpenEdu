import { describe, it, expect, afterEach, vi } from "vitest";

// llm.ts calls @tauri-apps/plugin-http's fetch; the headless shim forwards to globalThis.fetch, which
// each test replaces with a fake provider. Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMStructured } from "./llm";
import { parseReflection } from "./knowledge-reflect";
import { tryParseJsonLenient } from "./json-lenient";
import type { LLMConfig } from "../types";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["question", "options"],
  properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
};
const USER = [{ role: "user", content: "Write one question." }];

// Exactly what gemma4:e2b sent: LaTeX inside JSON strings with single backslashes. \t \f \b are valid
// JSON escapes, so this parses, and without the repair the child sees a TAB, a form feed, a backspace.
const MODEL_JSON = String.raw`{"question":"What is the area of a circle of radius r? Use 2\text{πr} and 3 \times 4.","options":["\frac{1}{2}","\begin{pmatrix}1\end{pmatrix}","Step 1.\nStep 2."]}`;
const SHOWN = {
  question: String.raw`What is the area of a circle of radius r? Use 2\text{πr} and 3 \times 4.`,
  options: [String.raw`\frac{1}{2}`, String.raw`\begin{pmatrix}1\end{pmatrix}`, "Step 1.\nStep 2."],
};

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

function fake(reply: (url: string) => Response) {
  globalThis.fetch = ((url: string) => Promise.resolve(reply(String(url)))) as unknown as typeof fetch;
}

describe("callLLMStructured repairs LaTeX that JSON escapes ate, on every provider", () => {
  it("Ollama", async () => {
    fake((url) => url.endsWith("/api/chat")
      ? Response.json({ message: { content: MODEL_JSON }, done: true, done_reason: "stop" })
      : new Response("{}", { status: 404 }));
    const config = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
    expect(await callLLMStructured(USER, config, { schema: SCHEMA })).toEqual(SHOWN);
  });

  it("OpenAI", async () => {
    fake(() => Response.json({ choices: [{ message: { content: MODEL_JSON } }] }));
    const config = { provider: "openai", model: "gpt-6.1-sol", apiKey: "test-key" } as LLMConfig;
    expect(await callLLMStructured(USER, config, { schema: SCHEMA })).toEqual(SHOWN);
  });

  it("Anthropic (tool input arrives already parsed)", async () => {
    // Anthropic's server parses the model's tool JSON and re-serialises it, so the reply is valid JSON
    // whose strings already hold the TAB / form feed / backspace.
    const input = tryParseJsonLenient(MODEL_JSON);
    expect(JSON.stringify(input)).toContain("\\t");
    fake(() => Response.json({ content: [{ type: "tool_use", input }] }));
    const config = { provider: "anthropic", model: "claude-opus-4-6", apiKey: "test-key" } as LLMConfig;
    expect(await callLLMStructured(USER, config, { schema: SCHEMA })).toEqual(SHOWN);
  });
});

describe("the knowledge reflection reply", () => {
  it("keeps \\text and \\frac instead of a TAB and a form feed", () => {
    const files = parseReflection(String.raw`{"misconceptions":"Wrote 2\text{πr} for the area; \frac{1}{2} is not 2"}`);
    expect(files.misconceptions).toBe(String.raw`Wrote 2\text{πr} for the area; \frac{1}{2} is not 2`);
  });
});
