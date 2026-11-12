import { describe, it, expect } from "vitest";
import { specFromModelfile, type KitCandidate } from "./model-kit";

// scripts/export-model.mjs writes the kits the importer reads. These tests run its real functions (the
// ones main() calls) and feed what it writes back through the importer's own parser, so a value the
// script writes is a value the app reads.

interface ExportModule {
  modelfileFor(layers: { mediaType: string; digest: string }[], readText: (l: { digest: string }) => string, config: Record<string, unknown>): string;
  quoteModelfileValue(s: string, what: string): string;
  parseRef(ref: string): string[];
  kitProblem(stores: string[], kits: string[]): string | null;
  realish(p: string): string;
}
interface Fs {
  mkdtempSync(prefix: string): string;
  mkdirSync(p: string, o?: { recursive: boolean }): void;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
  realpathSync: { native(p: string): string };
}
interface Os { tmpdir(): string }
interface Path { join(...p: string[]): string }
const load = <T>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const script = () => load<ExportModule>("../../scripts/export-model.mjs");

const MT = "application/vnd.ollama.image.";

/** Export a model whose layers have these texts, then import the Modelfile it wrote. */
async function roundTrip(texts: Record<string, string>) {
  const { modelfileFor } = await script();
  const layers = Object.keys(texts).map((t) => ({ mediaType: MT + t, digest: t }));
  const modelfile = modelfileFor(layers, (l) => texts[l.digest], { renderer: "qwen3.5", parser: "qwen3.5" });
  const c: Extract<KitCandidate, { kind: "gguf" }> = {
    kind: "gguf", dir: "models/m", modelfile, ggufs: [{ rel: "models/m/model.gguf", bytes: 1 }],
    checksums: `${"a".repeat(64)}  model.gguf`, licenceFiles: [],
  };
  return specFromModelfile(c);
}

describe("export-model.mjs Modelfile round trip", () => {
  it("keeps a stop token with a newline, quotes and backslashes exactly", async () => {
    const r = await roundTrip({
      params: JSON.stringify({ stop: ["<|end|>\n", 'say "hi" now', "a\\nb"], temperature: 0.7 }),
      template: '{{ .System }}\n<|user|>{{ .Prompt }} and "quoted" text',
      license: "Apache License\nVersion 2.0",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.parameters).toEqual({ stop: ["<|end|>\n", 'say "hi" now', "a\\nb"], temperature: 0.7 });
    expect(r.spec.template).toBe('{{ .System }}\n<|user|>{{ .Prompt }} and "quoted" text');
    expect(r.spec.license).toEqual(["Apache License\nVersion 2.0"]);
    expect(r.spec.renderer).toBe("qwen3.5");
  });

  // A triple-quoted value that ends in a quote reads back one quote short; refusing beats writing it wrong.
  it("refuses a template that ends or starts with a quote, and a value holding three quotes", async () => {
    await expect(roundTrip({ template: '{{ .Prompt }}"' })).rejects.toThrow(/starts or ends with a quote mark/);
    await expect(roundTrip({ params: JSON.stringify({ stop: ['"end'] }) })).rejects.toThrow(/stop setting/);
    const { quoteModelfileValue } = await script();
    expect(() => quoteModelfileValue('a """ b', "system prompt")).toThrow(/--layout ollama/);
    expect(quoteModelfileValue("plain", "x")).toBe('"""plain"""');
  });
});

describe("export-model.mjs model names", () => {
  it("accepts Ollama's name forms", async () => {
    const { parseRef } = await script();
    expect(parseRef("qwen3.5:0.8b")).toEqual(["registry.ollama.ai", "library", "qwen3.5", "0.8b"]);
    expect(parseRef("me/tutor")).toEqual(["registry.ollama.ai", "me", "tutor", "latest"]);
    expect(parseRef("hf.co/org/m:q4")).toEqual(["hf.co", "org", "m", "q4"]);
  });

  it("refuses anything that could name a path outside the store", async () => {
    const { parseRef } = await script();
    for (const bad of ["../x", "a/../../b:c", "x:..", "./x", "a/b/c/d", "x y", "x:a/b\\c", ""]) {
      expect(() => parseRef(bad), bad).toThrow(/is not a model name/);
    }
  });
});

describe("export-model.mjs kit folder", () => {
  const store = "/home/u/.ollama/models";

  it("refuses a kit whose models folder is, or is inside, the store", async () => {
    const { kitProblem } = await script();
    expect(kitProblem([store], ["/home/u/.ollama"])).toMatch(/inside Ollama's model store/);
    expect(kitProblem([store], ["/home/u/.ollama/models/kit"])).toMatch(/inside Ollama's model store/);
  });

  it("refuses a kit that contains the store", async () => {
    const { kitProblem } = await script();
    expect(kitProblem([store], ["/home/u"])).toMatch(/store is inside the kit folder/);
    expect(kitProblem([store], ["/"])).toMatch(/store is inside the kit folder/);
  });

  it("allows a kit beside the store", async () => {
    const { kitProblem } = await script();
    expect(kitProblem([store], ["/media/stick/OpenEdu-Kit"])).toBeNull();
    expect(kitProblem([store], ["/home/u/.ollama/models-kit"])).toBeNull();
  });

  // Found live: ~/.ollama/models was a junction to D:, so the real paths alone let the home folder pass
  // as a kit. Checking the typed form too catches it.
  it("checks the typed and the real path, so a store behind a junction is still found", async () => {
    const { kitProblem } = await script();
    const typed = "/home/u/.ollama/models";
    const real = "/mnt/d/offload/.ollama/models";
    expect(kitProblem([real], ["/home/u"])).toBeNull();
    expect(kitProblem([typed, real], ["/home/u"])).toMatch(/store is inside the kit folder/);
    expect(kitProblem([typed, real], ["/mnt/d/offload/.ollama"])).toMatch(/inside Ollama's model store/);
  });

  it("resolves a kit that doesn't exist yet through its nearest real folder", async () => {
    const { realish } = await script();
    const fs = await load<Fs>("node:fs");
    const os = await load<Os>("node:os");
    const path = await load<Path>("node:path");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
    try {
      const real = fs.realpathSync.native(base);
      expect(realish(path.join(base, "not", "yet"))).toBe(path.join(real, "not", "yet"));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
