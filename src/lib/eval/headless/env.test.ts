import { describe, it, expect } from "vitest";
import { parseEvalEnv, storeValuesFor, defaultOutPath, DEFAULT_EVAL_MODEL } from "./env";

describe("parseEvalEnv", () => {
  it("defaults to the RAG main set on the primary model, once, via local Ollama", () => {
    const o = parseEvalEnv({});
    expect(o).toMatchObject({ suite: "rag", provider: "ollama", model: DEFAULT_EVAL_MODEL, set: "main", repeats: 1, ollamaUrl: "http://127.0.0.1:11434" });
    expect(o.modes).toBeUndefined(); // the runner's own default, both mechanisms
    expect(o.out).toBeUndefined();
  });

  it("reads every option", () => {
    const o = parseEvalEnv({
      EVAL_MODEL: "qwen3.5:2b", EVAL_SET: "dev", EVAL_REPEATS: "3", EVAL_MODES: "always,off", EVAL_ONLY: "h-nm01,h-nm03",
      EVAL_SYLLABUS: "matched", EVAL_CTX: "4096", EVAL_OUT: "x.json", EVAL_EMBED_MODEL: "nomic-embed-text",
    });
    expect(o).toMatchObject({ model: "qwen3.5:2b", set: "dev", repeats: 3, modes: ["always", "off"], only: "h-nm01,h-nm03", syllabus: "matched", maxContextTokens: 4096, out: "x.json", embedModel: "nomic-embed-text" });
  });

  it("names every bad value in one error", () => {
    let msg = "";
    try {
      parseEvalEnv({ EVAL_SUITE: "k12", EVAL_SET: "sealed", EVAL_REPEATS: "0", EVAL_MODES: "sometimes", EVAL_PROVIDER: "openai" });
    } catch (e) { msg = (e as Error).message; }
    for (const k of ["EVAL_SUITE", "EVAL_SEALED", "EVAL_REPEATS", "EVAL_MODES", "EVAL_API_KEY"]) expect(msg).toContain(k);
  });
});

describe("storeValuesFor", () => {
  it("sets only what a learner sets by picking a model in Settings, plus explicit overrides", () => {
    expect(storeValuesFor(parseEvalEnv({}))).toEqual({
      llm_provider: "ollama", chat_model: DEFAULT_EVAL_MODEL, gen_model: DEFAULT_EVAL_MODEL, ollama_url: "http://127.0.0.1:11434",
    });
    expect(storeValuesFor(parseEvalEnv({ EVAL_CTX: "4096", EVAL_EMBED_MODEL: "e" }))).toMatchObject({ max_context_tokens: 4096, embedding_model: "e" });
  });
});

describe("defaultOutPath", () => {
  it("lands under .dev/eval-runs with a filesystem-safe name", () => {
    expect(defaultOutPath(parseEvalEnv({ EVAL_SET: "dev" }), new Date("2026-11-07T10:20:30.456Z")))
      .toBe(".dev/eval-runs/2026-11-07T10-20-30-456-rag-dev-gemma4_e2b.json");
  });
});
