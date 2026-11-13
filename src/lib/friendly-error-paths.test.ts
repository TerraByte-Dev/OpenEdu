import { describe, it, expect, vi, afterEach } from "vitest";

// The real error each screen catches, made by the real code that throws it, then the sentence the
// screen shows. llm.ts calls @tauri-apps/plugin-http's fetch; the headless shim forwards to
// globalThis.fetch, which each test replaces with a fake Ollama. Nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));
// The memory read fails, the way it does when the Rust command errors.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => { throw new Error("command failed"); }) }));
// Notes search reads its model from the settings store; the kit default is nomic-embed-text.
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  getEmbeddingConfig: vi.fn(async () => ({ provider: "ollama", model: "nomic-embed-text", ollamaUrl: "http://127.0.0.1:11434" })),
}));

import { callLLMTurn, type NeutralMessage } from "./llm";
import { generateLesson } from "./curriculum";
import { searchNotebook } from "./notebook";
import { systemMemoryBytes } from "./store";
import { friendlyError, STALLED_TURN } from "./plain-language";
import type { LLMConfig } from "../types";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const LOCAL = { provider: "ollama", model: "gemma4:e2b", ollamaUrl: "http://127.0.0.1:11434" } as LLMConfig;
const USER: NeutralMessage[] = [{ role: "user", content: "hi" }];
const ENGINEERING = /JSON|schema|ollama pull|nomic|embed|attempts|Issues:|error 500|context window|\{/i;

function fakeOllama(respond: (url: string) => Response) {
  globalThis.fetch = ((url: string) => Promise.resolve(respond(String(url)))) as unknown as typeof fetch;
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); } catch (e) { return e; }
  throw new Error("expected it to fail");
}

async function turnError(config: LLMConfig): Promise<unknown> {
  return caught(async () => { for await (const ev of callLLMTurn(USER, config)) void ev; });
}

describe("the lessons screen", () => {
  it("shows a plain sentence when the model never returns a lesson", async () => {
    fakeOllama(() => new Response(JSON.stringify({ message: { content: "Sure! Here is a lesson about fractions." }, done: true, done_reason: "stop" }), { status: 200 }));
    const e = await caught(() => generateLesson("c1", 1, { id: "s1", title: "Fractions", key_concepts: ["halves"] }, "Maths", { ...LOCAL, modelTier: "small" }));

    expect(String(e)).toMatch(/Structured output failed/);
    // LessonsTab: `Couldn't make that lesson. ${friendlyError(e)}`
    const shown = `Couldn't make that lesson. ${friendlyError(e)}`;
    expect(shown).toBe("Couldn't make that lesson. The tutor couldn't put this together this time. Try again.");
  });
});

describe("notes search", () => {
  it("on a kit install without the search model says search isn't set up, not `ollama pull`", async () => {
    fakeOllama((url) => url.endsWith("/api/embed")
      ? new Response('{"error":"model \\"nomic-embed-text\\" not found, try pulling it first"}', { status: 404 })
      : new Response("{}", { status: 404 }));
    const e = await caught(() => searchNotebook({ courseId: "c1", query: "fractions" }));

    expect(friendlyError(e)).toBe("Notebook search isn't set up on this computer yet, so your notes can't be searched. Open Settings to add it.");
  });
});

describe("model advice when the computer's memory can't be read", () => {
  it("never names gemma4:e4b", async () => {
    const ramBytes = await systemMemoryBytes();
    expect(ramBytes).toBeNull();
    const shown = friendlyError("Structured output failed after 3 attempts. Issues: response did not contain valid JSON.", { model: "gemma4:e2b", provider: "ollama", ramBytes });
    expect(shown).toBe("The tutor couldn't put this together this time. Try again.");
  });
});

describe("a cloud tutor with no API key", () => {
  it("tells the parent to add the key, not to try again", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const e = await turnError({ provider, model: "m" } as LLMConfig);
      expect(String(e)).toMatch(/API key not set/);
      expect(friendlyError(e)).toBe("Add your API key in Settings, then try again.");
    }
  });
});

describe("Ollama failing partway", () => {
  it("out of memory says to close other programs, not to restart Ollama", async () => {
    fakeOllama(() => new Response('{"error":"model requires more system memory (9.6 GiB) than is available (5.1 GiB)"}', { status: 500 }));
    const e = await turnError(LOCAL);

    expect(String(e)).toMatch(/^Error: Ollama error 500/);
    const shown = friendlyError(e);
    expect(shown).toBe("This computer doesn't have enough free memory for the tutor right now. Close other programs, then try again.");
    expect(shown).not.toMatch(ENGINEERING);
  });

  it("an error in the middle of the stream gets the plain sentence, not the fallback", async () => {
    const body = [
      JSON.stringify({ message: { content: "Half of" }, done: false }),
      JSON.stringify({ error: "llama runner process has terminated: exit status 2" }),
    ].join("\n") + "\n";
    fakeOllama(() => new Response(body, { status: 200 }));
    const e = await turnError(LOCAL);

    expect(String(e)).toMatch(/^Error: Ollama error: /);
    expect(friendlyError(e)).toBe("The tutor ran into a problem. Try again. If it keeps happening, close Ollama and start it again.");
  });
});

describe("a chat turn that stalls", () => {
  it("says what to do without jargon", () => {
    expect(STALLED_TURN).toBe("The tutor stopped partway. Try again. If it keeps happening, close other programs or pick a smaller model in Settings.");
    expect(STALLED_TURN).not.toMatch(/context|output|local model/i);
  });
});
