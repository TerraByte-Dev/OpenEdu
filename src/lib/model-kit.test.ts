import { describe, it, expect } from "vitest";
import {
  parseModelfile, typedParameters, parseChecksums, specFromModelfile, specFromOllama, specFor,
  validModelName, nameTaken, nameProblem, suggestedName, candidateBytes, needsNewerOllama, hasRoom,
  importFraction, etaSeconds, formatEta, formatBytes, SPARE_BYTES, type KitCandidate, type KitLayer,
} from "./model-kit";

const HEX = "a".repeat(64);
const gguf = (modelfile: string, over: Partial<Extract<KitCandidate, { kind: "gguf" }>> = {}): Extract<KitCandidate, { kind: "gguf" }> => ({
  kind: "gguf",
  dir: "models/tiny",
  modelfile,
  ggufs: [{ rel: "models/tiny/model.gguf", bytes: 1000 }],
  checksums: null,
  ...over,
});

describe("parseModelfile", () => {
  it("reads instructions, comments, quotes and triple quotes", () => {
    const { commands, errors } = parseModelfile(
      [
        "# exported by OpenEdu",
        "FROM ./model.gguf",
        'TEMPLATE """{{ if .System }}<|system|>',
        '{{ .System }}{{ end }}"""',
        'SYSTEM "You are a \\"kind\\" tutor."',
        "PARAMETER temperature 0.7",
        'PARameter stop "<|im_end|>"',
        "PARAMETER stop <|endoftext|>",
        "message user Hi there",
        "LICENSE Apache-2.0",
        "",
      ].join("\r\n"),
    );
    expect(errors).toEqual([]);
    expect(commands.map((c) => c.name)).toEqual(["FROM", "TEMPLATE", "SYSTEM", "PARAMETER", "PARAMETER", "PARAMETER", "MESSAGE", "LICENSE"]);
    expect(commands[1].value).toBe("{{ if .System }}<|system|>\n{{ .System }}{{ end }}");
    expect(commands[2].value).toBe('You are a "kind" tutor.');
    expect(commands[4]).toMatchObject({ key: "stop", value: "<|im_end|>" });
    expect(commands[6]).toMatchObject({ name: "MESSAGE", key: "user", value: "Hi there", line: 9 });
  });

  it("names the line of an unknown instruction and of an unclosed quote", () => {
    expect(parseModelfile("FROM x.gguf\nWIBBLE 1").errors).toEqual(['Line 2: "WIBBLE" is not a Modelfile instruction OpenEdu knows.']);
    expect(parseModelfile('FROM x.gguf\nSYSTEM """never closed').errors[0]).toMatch(/Line 2: a quote is opened/);
    expect(parseModelfile("PARAMETER\n").errors[0]).toMatch(/needs a name and a value/);
  });
});

describe("typedParameters", () => {
  it("numbers, booleans, strings, and stop as a list", () => {
    const { commands } = parseModelfile("PARAMETER temperature 0.7\nPARAMETER num_ctx 8192\nPARAMETER penalize_newline false\nPARAMETER stop a\nPARAMETER stop b\nPARAMETER mode x");
    expect(typedParameters(commands)).toEqual({ temperature: 0.7, num_ctx: 8192, penalize_newline: false, stop: ["a", "b"], mode: "x" });
  });
});

describe("parseChecksums", () => {
  it("reads sha256sum output, binary marks and paths", () => {
    const m = parseChecksums(`${HEX}  model.gguf\n${"B".repeat(64)} *./sub/Proj.gguf\nnot a line\n`);
    expect(m.get("model.gguf")).toBe(`sha256:${HEX}`);
    expect(m.get("Proj.gguf")).toBe(`sha256:${"b".repeat(64)}`);
    expect(m.size).toBe(2);
    expect(parseChecksums(null).size).toBe(0);
  });
});

describe("specFromModelfile", () => {
  it("builds a create request from a GGUF beside its Modelfile, with its checksum", () => {
    const r = specFromModelfile(gguf("FROM ./model.gguf\nRENDERER qwen3.5\nPARSER qwen3.5\nLICENSE MIT\nLICENSE Terms\nPARAMETER top_k 20", { checksums: `${HEX}  model.gguf` }));
    expect(r).toEqual({
      ok: true,
      spec: {
        files: [{ label: "model.gguf", rel: "models/tiny/model.gguf", expect: `sha256:${HEX}` }],
        renderer: "qwen3.5",
        parser: "qwen3.5",
        parameters: { top_k: 20 },
        license: ["MIT", "Terms"],
      },
    });
  });

  it("accepts a Windows-style relative path and differing case", () => {
    const r = specFromModelfile(gguf("FROM .\\Model.GGUF"));
    expect(r.ok && r.spec.files[0].rel).toBe("models/tiny/model.gguf");
  });

  it("refuses a FROM outside the folder", () => {
    for (const from of ["../other/model.gguf", "C:\\models\\model.gguf", "/etc/model.gguf", "~/m.gguf", "sub/../../x.gguf"]) {
      const r = specFromModelfile(gguf(`FROM ${from}`));
      expect(r.ok, from).toBe(false);
      expect(!r.ok && r.errors[0]).toMatch(/outside this folder/);
    }
  });

  it("refuses a FROM that names a model to download", () => {
    const r = specFromModelfile(gguf("FROM gemma4:e2b"));
    expect(!r.ok && r.errors[0]).toMatch(/not a \.gguf file/);
  });

  it("refuses a missing file, no FROM, two FROMs, and an adapter", () => {
    expect(specFromModelfile(gguf("FROM ./gone.gguf"))).toEqual({ ok: false, errors: ["gone.gguf is named in the Modelfile but isn't in the folder."] });
    expect(specFromModelfile(gguf("SYSTEM hi")).ok).toBe(false);
    expect(specFromModelfile(gguf("FROM model.gguf\nFROM model.gguf")).ok).toBe(false);
    const a = specFromModelfile(gguf("FROM model.gguf\nADAPTER lora.gguf"));
    expect(!a.ok && a.errors[0]).toMatch(/ADAPTER/);
  });

  it("collects every shard of a split GGUF under its own name", () => {
    const ggufs = [1, 2, 3].map((n) => ({ rel: `m-0000${n}-of-00003.gguf`, bytes: 10 }));
    const r = specFromModelfile(gguf("FROM m-00001-of-00003.gguf", { dir: "", ggufs }));
    expect(r.ok && r.spec.files.map((f) => f.label)).toEqual(["m-00001-of-00003.gguf", "m-00002-of-00003.gguf", "m-00003-of-00003.gguf"]);
    const missing = specFromModelfile(gguf("FROM m-00001-of-00003.gguf", { dir: "", ggufs: ggufs.slice(0, 2) }));
    expect(!missing.ok && missing.errors).toEqual(["m-00003-of-00003.gguf is named in the Modelfile but isn't in the folder."]);
  });
});

const layer = (t: string, over: Partial<KitLayer> = {}): KitLayer => ({
  mediaType: `application/vnd.ollama.image.${t}`, digest: `sha256:${HEX}`, size: 10, rel: null, text: null, ...over,
});
const ollama = (layers: KitLayer[], config: string | null = '{"renderer":"qwen3.5","parser":"qwen3.5","requires":"0.17.1"}'): Extract<KitCandidate, { kind: "ollama" }> =>
  ({ kind: "ollama", name: "qwen3.5:0.8b", config, layers });

describe("specFromOllama", () => {
  it("rebuilds qwen3.5:0.8b's create request from its export (the live-tested shape)", () => {
    const r = specFromOllama(ollama([
      layer("model", { rel: "models/blobs/sha256-x", size: 1036034688 }),
      layer("license", { text: "Apache License 2.0" }),
      layer("params", { text: '{"presence_penalty":1.5,"temperature":1,"top_k":20,"top_p":0.95}' }),
    ]));
    expect(r).toEqual({
      ok: true,
      spec: {
        files: [{ label: "model.gguf", rel: "models/blobs/sha256-x" }],
        renderer: "qwen3.5",
        parser: "qwen3.5",
        requires: "0.17.1",
        parameters: { presence_penalty: 1.5, temperature: 1, top_k: 20, top_p: 0.95 },
        license: ["Apache License 2.0"],
      },
    });
  });

  it("sends a projector as a file and a draft as a draft file (gemma4's shape)", () => {
    const r = specFromOllama(ollama([
      layer("model", { rel: "b/1" }), layer("projector", { rel: "b/2" }), layer("draft", { rel: "b/3" }), layer("template", { text: "{{ .Prompt }}" }),
    ]));
    expect(r.ok && r.spec.files).toEqual([
      { label: "model.gguf", rel: "b/1" }, { label: "projector.gguf", rel: "b/2" }, { label: "draft.gguf", rel: "b/3", draft: true },
    ]);
    expect(r.ok && r.spec.template).toBe("{{ .Prompt }}");
  });

  it("refuses no weights, split weights, an adapter, a missing blob and damaged params", () => {
    expect(specFromOllama(ollama([layer("license", { text: "x" })])).ok).toBe(false);
    expect(specFromOllama(ollama([layer("model", { rel: "a" }), layer("model", { rel: "b" })])).ok).toBe(false);
    expect(specFromOllama(ollama([layer("model", { rel: "a" }), layer("adapter", { rel: "b" })])).ok).toBe(false);
    expect(specFromOllama(ollama([layer("model")])).ok).toBe(false);
    const bad = specFromOllama(ollama([layer("model", { rel: "a" }), layer("params", { text: "{not json" })]));
    expect(!bad.ok && bad.errors[0]).toMatch(/damaged/);
  });

  it("an unreadable config only loses hints, never the import", () => {
    const r = specFromOllama(ollama([layer("model", { rel: "a" })], "{broken"));
    expect(r).toEqual({ ok: true, spec: { files: [{ label: "model.gguf", rel: "a" }] } });
  });

  it("specFor dispatches on kind", () => {
    expect(specFor(gguf("FROM model.gguf")).ok).toBe(true);
    expect(specFor(ollama([layer("model", { rel: "a" })])).ok).toBe(true);
  });
});

describe("names", () => {
  it("validModelName matches the Rust rule", () => {
    for (const ok of ["kit-test-qwen0.8b", "qwen3.5:0.8b", "me/tutor:v1", "a"]) expect(validModelName(ok), ok).toBe(true);
    for (const bad of ["", ":tag", "-x", "a b", "host/ns/model", "x:", "x:y:z", "../x", "x/", "ünï"]) expect(validModelName(bad), bad).toBe(false);
  });

  it("nameTaken treats a bare name as :latest", () => {
    expect(nameTaken("phi4-mini", ["phi4-mini:latest"])).toBe(true);
    expect(nameTaken("QWEN3.5:0.8b", ["qwen3.5:0.8b"])).toBe(true);
    expect(nameTaken("qwen3.5:2b", ["qwen3.5:0.8b"])).toBe(false);
  });

  it("nameProblem says what's wrong in plain words", () => {
    expect(nameProblem("  ", [])).toBe("Give the model a name.");
    expect(nameProblem("a b", [])).toMatch(/letters, numbers/);
    expect(nameProblem("qwen3.5:0.8b", ["qwen3.5:0.8b"])).toMatch(/already has .* nothing gets replaced/);
    expect(nameProblem("kit-test-qwen0.8b", ["qwen3.5:0.8b"])).toBeNull();
  });

  it("suggestedName uses the export's own name or a tidy folder name", () => {
    expect(suggestedName(ollama([]))).toBe("qwen3.5:0.8b");
    expect(suggestedName(gguf("", { dir: "models/My Tutor Model!" }))).toBe("my-tutor-model");
    expect(suggestedName(gguf("", { dir: "", ggufs: [{ rel: "Phi-4.Q4.gguf", bytes: 1 }] }))).toBe("phi-4.q4");
    expect(suggestedName(gguf("", { dir: "", ggufs: [] }))).toBe("imported-model");
  });
});

describe("sizes and versions", () => {
  it("candidateBytes counts only files that get sent", () => {
    expect(candidateBytes(ollama([layer("model", { rel: "a", size: 100 }), layer("license", { size: 5, text: "x" })]))).toBe(100);
    expect(candidateBytes(gguf("", { ggufs: [{ rel: "a", bytes: 3 }, { rel: "b", bytes: 4 }] }))).toBe(7);
  });

  it("hasRoom keeps 1 GB spare, like the Rust check", () => {
    expect(hasRoom(1e9, null)).toBeNull();
    expect(hasRoom(1e9, 1e9 + SPARE_BYTES)).toBe(true);
    expect(hasRoom(1e9, 1e9 + SPARE_BYTES - 1)).toBe(false);
  });

  it("needsNewerOllama", () => {
    expect(needsNewerOllama("0.17.1", "0.40.15")).toBe(false);
    expect(needsNewerOllama("0.30.9", "0.12.0")).toBe(true);
    expect(needsNewerOllama(undefined, "0.1.0")).toBe(false);
    expect(needsNewerOllama("0.30.9", null)).toBe(false);
  });

  it("formatBytes", () => {
    expect(formatBytes(1036034688)).toBe("1.0 GB");
    expect(formatBytes(11354)).toBe("11 KB");
    expect(formatBytes(274_000_000)).toBe("274 MB");
  });
});

describe("progress", () => {
  it("both byte passes get half the bar, in order, and never go backwards across phases", () => {
    const t = 1000;
    const points = [
      importFraction("checking", 0, t),
      importFraction("verifying", 0, t), importFraction("verifying", 500, t), importFraction("verifying", t, t),
      importFraction("copying", 0, t), importFraction("copying", t, t),
      importFraction("finishing", 0, t),
    ];
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(importFraction("verifying", 500, t)).toBeCloseTo(0.26);
    expect(importFraction("copying", t, t)).toBeCloseTo(0.97);
    expect(importFraction("finishing", 0, t)).toBeCloseTo(0.97);
  });

  it("clamps odd input", () => {
    expect(importFraction("verifying", 2000, 1000)).toBeCloseTo(0.5);
    expect(importFraction("verifying", -5, 1000)).toBeCloseTo(0.02);
    expect(importFraction("copying", 5, 0)).toBeCloseTo(0.5);
  });

  it("eta waits for enough data, then extrapolates", () => {
    expect(etaSeconds(0, 100, 10_000)).toBeNull();
    expect(etaSeconds(10, 100, 1000)).toBeNull();
    expect(etaSeconds(100, 100, 10_000)).toBeNull();
    expect(etaSeconds(25, 100, 10_000)).toBe(30);
    expect(formatEta(30)).toBe("less than a minute left");
    expect(formatEta(90)).toBe("about 2 minutes left");
    expect(formatEta(65)).toBe("about a minute left");
    expect(formatEta(null)).toBe("");
  });
});
