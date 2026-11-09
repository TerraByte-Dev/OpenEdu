import { describe, it, expect } from "vitest";
import { parseEvalEnv, storeValuesFor, defaultOutPath, sealedGitRefusal, DEFAULT_EVAL_MODEL, B7_DEFAULT_OLLAMA_URL } from "./env";

describe("parseEvalEnv", () => {
  it("reads EVAL_NOTES_MEANING (lever 9g's paired arm) and refuses it where it cannot apply", () => {
    expect(parseEvalEnv({}).notesMeaning).toBeUndefined();
    expect(parseEvalEnv({ EVAL_NOTES_MEANING: "off" }).notesMeaning).toBe("off");
    expect(() => parseEvalEnv({ EVAL_NOTES_MEANING: "x" })).toThrow(/EVAL_NOTES_MEANING=x: use on or off/);
    expect(() => parseEvalEnv({ EVAL_NOTES_MEANING: "off", EVAL_SUITE: "k12-flow" })).toThrow(/EVAL_NOTES_MEANING does not apply to k12-flow/);
    expect(() => parseEvalEnv({ EVAL_NOTES_MEANING: "off", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_NOTES_MEANING=off with EVAL_TURN_NOTES=off/);
    expect(() => parseEvalEnv({ EVAL_NOTES_MEANING: "off", EVAL_NOTES_MISS: "off" })).toThrow(/is meaningless/);
  });

  it("reads EVAL_PASSAGE_WINDOW (lever 10's paired arm) and refuses it where it cannot apply", () => {
    expect(parseEvalEnv({}).passageWindow).toBeUndefined();
    expect(parseEvalEnv({ EVAL_PASSAGE_WINDOW: "off" }).passageWindow).toBe("off");
    expect(() => parseEvalEnv({ EVAL_PASSAGE_WINDOW: "no" })).toThrow(/EVAL_PASSAGE_WINDOW=no: use on or off/);
    expect(() => parseEvalEnv({ EVAL_PASSAGE_WINDOW: "off", EVAL_SUITE: "k12-flow" })).toThrow(/EVAL_PASSAGE_WINDOW does not apply to k12-flow/);
    expect(() => parseEvalEnv({ EVAL_PASSAGE_WINDOW: "off", EVAL_SET: "sealed", EVAL_SEALED: "x" })).toThrow(/EVAL_PASSAGE_WINDOW is not allowed with EVAL_SET=sealed/);
  });

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

  it("takes the dev vault v2 set for RAG, and refuses it for k12-flow", () => {
    expect(parseEvalEnv({ EVAL_SET: "dev-v2" })).toMatchObject({ suite: "rag", set: "dev-v2" });
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SET: "dev-v2" })).toThrow(/EVAL_SET=dev-v2: k12-flow runs only the dev items/);
  });

  it("names every bad value in one error", () => {
    let msg = "";
    try {
      parseEvalEnv({ EVAL_SUITE: "k12", EVAL_SET: "sealed", EVAL_REPEATS: "0", EVAL_MODES: "sometimes", EVAL_PROVIDER: "openai" });
    } catch (e) { msg = (e as Error).message; }
    for (const k of ["EVAL_SUITE", "EVAL_SEALED", "EVAL_REPEATS", "EVAL_MODES", "EVAL_API_KEY"]) expect(msg).toContain(k);
  });

  it("reads EVAL_WIRE and EVAL_NUM_GPU, off by default", () => {
    expect(parseEvalEnv({})).toMatchObject({ wire: false, numGpu: undefined });
    expect(parseEvalEnv({ EVAL_WIRE: "1", EVAL_NUM_GPU: "0" })).toMatchObject({ wire: true, numGpu: 0 });
    expect(() => parseEvalEnv({ EVAL_WIRE: "yes" })).toThrow(/EVAL_WIRE/);
    expect(() => parseEvalEnv({ EVAL_NUM_GPU: "-1" })).toThrow(/EVAL_NUM_GPU/);
    expect(() => parseEvalEnv({ EVAL_NUM_GPU: "0", EVAL_SET: "sealed", EVAL_SEALED: "x.json" })).toThrow(/EVAL_NUM_GPU is not allowed with EVAL_SET=sealed/);
  });

  it("reads EVAL_TURN_NOTES for rag only, unset by default, and refuses it on k12-flow, k12-flow-fr, b7-cpu and the sealed set", () => {
    expect(parseEvalEnv({}).turnNotes).toBeUndefined();
    expect(parseEvalEnv({ EVAL_SET: "dev-v2", EVAL_TURN_NOTES: "off" })).toMatchObject({ turnNotes: "off" });
    expect(parseEvalEnv({ EVAL_TURN_NOTES: "on" })).toMatchObject({ turnNotes: "on" });
    expect(() => parseEvalEnv({ EVAL_TURN_NOTES: "false" })).toThrow(/EVAL_TURN_NOTES=false: use on or off/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_TURN_NOTES does not apply to k12-flow/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_TURN_NOTES does not apply to k12-flow-fr/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_TURN_NOTES does not apply to b7-cpu/);
    expect(() => parseEvalEnv({ EVAL_SET: "sealed", EVAL_SEALED: "x.json", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_TURN_NOTES is not allowed with EVAL_SET=sealed/);
  });

  it("reads EVAL_NOTES_MISS for rag only, unset by default, and refuses it where EVAL_TURN_NOTES is refused and with EVAL_TURN_NOTES=off", () => {
    expect(parseEvalEnv({}).notesMiss).toBeUndefined();
    expect(parseEvalEnv({ EVAL_SET: "dev-v2", EVAL_NOTES_MISS: "off" })).toMatchObject({ notesMiss: "off", turnNotes: undefined });
    expect(parseEvalEnv({ EVAL_NOTES_MISS: "on" })).toMatchObject({ notesMiss: "on" });
    expect(parseEvalEnv({ EVAL_NOTES_MISS: "on", EVAL_TURN_NOTES: "off" })).toMatchObject({ notesMiss: "on", turnNotes: "off" });
    expect(() => parseEvalEnv({ EVAL_NOTES_MISS: "false" })).toThrow(/EVAL_NOTES_MISS=false: use on or off/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_NOTES_MISS: "off" })).toThrow(/EVAL_NOTES_MISS does not apply to k12-flow/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_NOTES_MISS: "off" })).toThrow(/EVAL_NOTES_MISS does not apply to k12-flow-fr/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_NOTES_MISS: "off" })).toThrow(/EVAL_NOTES_MISS does not apply to b7-cpu/);
    expect(() => parseEvalEnv({ EVAL_SET: "sealed", EVAL_SEALED: "x.json", EVAL_NOTES_MISS: "off" })).toThrow(/EVAL_NOTES_MISS is not allowed with EVAL_SET=sealed/);
    expect(() => parseEvalEnv({ EVAL_SET: "dev-v2", EVAL_NOTES_MISS: "off", EVAL_TURN_NOTES: "off" })).toThrow(/EVAL_NOTES_MISS=off with EVAL_TURN_NOTES=off is meaningless/);
  });

  it("reads EVAL_NOTES_DROP for rag only, unset by default, and refuses it where EVAL_NOTES_MISS is refused and with no switch", () => {
    expect(parseEvalEnv({ EVAL_SET: "dev-v2" }).notesDrop).toBeUndefined();
    expect(parseEvalEnv({ EVAL_SET: "dev-v2", EVAL_NOTES_DROP: "off" })).toMatchObject({ notesDrop: "off", notesMiss: undefined, turnNotes: undefined });
    expect(() => parseEvalEnv({ EVAL_NOTES_DROP: "no" })).toThrow(/EVAL_NOTES_DROP=no: use on or off/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_NOTES_DROP: "off" })).toThrow(/EVAL_NOTES_DROP does not apply to k12-flow/);
    expect(() => parseEvalEnv({ EVAL_SET: "sealed", EVAL_SEALED: "x.json", EVAL_NOTES_DROP: "off" })).toThrow(/EVAL_NOTES_DROP is not allowed with EVAL_SET=sealed/);
    expect(() => parseEvalEnv({ EVAL_NOTES_DROP: "off", EVAL_NOTES_MISS: "off" })).toThrow(/EVAL_NOTES_DROP=off with EVAL_TURN_NOTES=off or EVAL_NOTES_MISS=off is meaningless/);
    expect(() => parseEvalEnv({ EVAL_NOTES_DROP: "off", EVAL_TURN_NOTES: "off" })).toThrow(/meaningless/);
  });

  it("takes lever 9e's probe sets for RAG, and refuses them for k12-flow", () => {
    expect(parseEvalEnv({ EVAL_SET: "probe-v2" })).toMatchObject({ suite: "rag", set: "probe-v2" });
    expect(parseEvalEnv({ EVAL_SET: "probe-v1", EVAL_NOTES_MISS: "off" })).toMatchObject({ suite: "rag", set: "probe-v1", notesMiss: "off" });
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SET: "probe-v2" })).toThrow(/EVAL_SET=probe-v2: k12-flow runs only the dev items/);
    expect(() => parseEvalEnv({ EVAL_SET: "probe-v3" })).toThrow(/EVAL_SET=probe-v3: use main, dev, test, dev-v2, probe-v2, probe-v1, blind-9f, sealed/);
    expect(parseEvalEnv({ EVAL_SET: "blind-9f" })).toMatchObject({ suite: "rag", set: "blind-9f" });
  });
});

describe("parseEvalEnv, k12-flow", () => {
  it("defaults to the dev items and reads EVAL_LIMIT, EVAL_SAMPLE and EVAL_ONLY", () => {
    expect(parseEvalEnv({ EVAL_SUITE: "k12-flow" })).toMatchObject({ suite: "k12-flow", set: "dev", repeats: 1 });
    expect(parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_LIMIT: "5", EVAL_SAMPLE: "24", EVAL_ONLY: "math-k5-01" })).toMatchObject({ limit: 5, sample: 24, only: "math-k5-01" });
  });
  it("refuses the sealed set and any other split, without asking for a path", () => {
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SET: "sealed" })).toThrow(/EVAL_SET=sealed: k12-flow runs only the dev items/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SET: "sealed" })).not.toThrow(/EVAL_SEALED=/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SET: "test" })).toThrow(/EVAL_SET=test/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SEALED: "x.json" })).toThrow(/EVAL_SEALED/);
  });
  it("refuses options its frozen protocol does not have, and bad counts", () => {
    for (const k of ["EVAL_REPEATS", "EVAL_MODES", "EVAL_SYLLABUS"]) expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", [k]: "2" })).toThrow(k);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_SAMPLE: "0" })).toThrow(/EVAL_SAMPLE=0/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow", EVAL_LIMIT: "2.5" })).toThrow(/EVAL_LIMIT=2.5/);
  });
  it("keeps EVAL_LIMIT and EVAL_SAMPLE to k12-flow", () => {
    expect(() => parseEvalEnv({ EVAL_LIMIT: "3" })).toThrow(/k12-flow only/);
  });
  it("names the suite in the default results path", () => {
    expect(defaultOutPath(parseEvalEnv({ EVAL_SUITE: "k12-flow" }), new Date("2026-11-07T10:20:30.456Z")))
      .toBe(".dev/eval-runs/2026-11-07T10-20-30-456-k12-flow-dev-gemma4_e2b.json");
  });
});

describe("parseEvalEnv, k12-flow-fr", () => {
  it("defaults to the dev items and takes the k12-flow item options", () => {
    expect(parseEvalEnv({ EVAL_SUITE: "k12-flow-fr" })).toMatchObject({ suite: "k12-flow-fr", set: "dev", repeats: 1 });
    expect(parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_LIMIT: "5", EVAL_SAMPLE: "12", EVAL_ONLY: "fr-math-k5-01" })).toMatchObject({ limit: 5, sample: 12, only: "fr-math-k5-01" });
  });
  it("refuses the sealed set, any other split, and the options k12-flow refuses", () => {
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_SET: "sealed" })).toThrow(/EVAL_SET=sealed: k12-flow-fr runs only the dev items/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_SET: "sealed", EVAL_SEALED: "x.json" })).toThrow(/EVAL_SEALED does not apply to k12-flow-fr/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", EVAL_SET: "test" })).toThrow(/EVAL_SET=test/);
    for (const k of ["EVAL_REPEATS", "EVAL_MODES", "EVAL_SYLLABUS"]) expect(() => parseEvalEnv({ EVAL_SUITE: "k12-flow-fr", [k]: "2" })).toThrow(k);
  });
  it("names the suite in the default results path, which k12-flow's rescore pattern does not match", () => {
    const out = defaultOutPath(parseEvalEnv({ EVAL_SUITE: "k12-flow-fr" }), new Date("2026-11-08T10:20:30.456Z"));
    expect(out).toBe(".dev/eval-runs/2026-11-08T10-20-30-456-k12-flow-fr-dev-gemma4_e2b.json");
    expect(/k12-flow-dev.*\.json$/.test(out)).toBe(false);
  });
});

describe("parseEvalEnv, b7-cpu", () => {
  it("defaults to the CPU server's port and 5 warm repeats, and reads the server log path", () => {
    const o = parseEvalEnv({ EVAL_SUITE: "b7-cpu" });
    expect(o).toMatchObject({ suite: "b7-cpu", set: "dev", repeats: 5, ollamaUrl: B7_DEFAULT_OLLAMA_URL, wire: false, numGpu: undefined, serverLog: undefined });
    expect(B7_DEFAULT_OLLAMA_URL).toBe("http://127.0.0.1:11435");
    expect(parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_REPEATS: "2", EVAL_MODEL: "qwen3.5:0.8b", EVAL_OLLAMA_URL: "http://127.0.0.1:11500", EVAL_B7_SERVER_LOG: "C:/t/ollama-cpu.log" }))
      .toMatchObject({ repeats: 2, model: "qwen3.5:0.8b", ollamaUrl: "http://127.0.0.1:11500", serverLog: "C:/t/ollama-cpu.log" });
  });

  it("refuses anything that would change the requests or the fixed scenarios", () => {
    for (const [k, v] of [["EVAL_NUM_GPU", "0"], ["EVAL_WIRE", "1"], ["EVAL_MODES", "off"], ["EVAL_ONLY", "h-pp01"], ["EVAL_SYLLABUS", "python"], ["EVAL_SEALED", "x.json"]]) {
      expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", [k]: v }), k).toThrow(new RegExp(`${k} does not apply to b7-cpu`));
    }
    expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_SET: "main" })).toThrow(/b7-cpu runs its own fixed dev scenarios/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_PROVIDER: "openai", EVAL_API_KEY: "k" })).toThrow(/b7-cpu runs on Ollama only/);
    expect(() => parseEvalEnv({ EVAL_SUITE: "b7-cpu", EVAL_SAMPLE: "3" })).toThrow(/EVAL_SAMPLE applies to k12-flow only/);
    expect(() => parseEvalEnv({ EVAL_B7_SERVER_LOG: "x.log" })).toThrow(/EVAL_B7_SERVER_LOG applies to b7-cpu only/);
  });

  it("leaves the other suites' default URL alone", () => {
    expect(parseEvalEnv({ EVAL_SUITE: "k12-flow" }).ollamaUrl).toBe("http://127.0.0.1:11434");
  });
});

describe("parseEvalEnv, sealed runs", () => {
  it("refuses options that would run part of the sealed set (a partial run still burns all of it)", () => {
    const sealed = { EVAL_SET: "sealed", EVAL_SEALED: "x.json" };
    expect(() => parseEvalEnv(sealed)).not.toThrow();
    expect(() => parseEvalEnv({ ...sealed, EVAL_ONLY: "s-nm01" })).toThrow(/EVAL_ONLY/);
    expect(() => parseEvalEnv({ ...sealed, EVAL_MODES: "always" })).toThrow(/EVAL_MODES/);
  });
});

describe("sealedGitRefusal (protocol rule 4)", () => {
  const ok = { commit: "abc", srcDirty: false, srcDiffersFromMaster: false, tags: ["eval-test-2026-11-08"] };
  it("allows a clean src/ that matches master, at an eval-test tag", () => {
    expect(sealedGitRefusal(ok)).toBeNull();
  });
  it("refuses uncommitted src/, a src/ that differs from master, no eval-test tag, or no git", () => {
    expect(sealedGitRefusal({ ...ok, srcDirty: true })).toMatch(/uncommitted/);
    expect(sealedGitRefusal({ ...ok, srcDiffersFromMaster: true })).toMatch(/master/);
    expect(sealedGitRefusal({ ...ok, tags: ["v0.9.0"] })).toMatch(/eval-test-/);
    expect(sealedGitRefusal({ commit: null, srcDirty: null, srcDiffersFromMaster: null, tags: null })).toMatch(/git/);
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
