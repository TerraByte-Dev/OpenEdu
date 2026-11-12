// Offline model import (#275): the pure half.
//
// `src-tauri/src/model_import.rs` finds the files in a picked folder, hashes them and moves the bytes to
// Ollama. Everything that is a DECISION lives here, where it is unit-tested: reading a Modelfile, turning
// an exported Ollama manifest into a create request, which files to send, whether a name is usable, and
// how far along an import is. No Tauri, no DOM.

import { compareVersions } from "./version";
import { APP_NAME } from "./product";

// ─── What the Rust scan returns (keep in sync with model_import.rs by hand) ─────────────────────────────

export interface KitFile {
  /** Relative to the picked folder, forward slashes. The only way to name a file to the importer. */
  rel: string;
  bytes: number;
}

export interface KitLayer {
  mediaType: string;
  digest: string;
  size: number;
  rel: string | null;
  text: string | null;
}

export type KitCandidate =
  | { kind: "gguf"; dir: string; modelfile: string; ggufs: KitFile[]; checksums: string | null; licenceFiles: string[] }
  | { kind: "ollama"; name: string; config: string | null; layers: KitLayer[]; licenceFiles: string[] };

export interface KitPlan {
  root: string;
  candidates: KitCandidate[];
  problems: string[];
  freeBytes: number | null;
}

// ─── What the Rust import accepts (`CreateSpec` in model_import.rs) ─────────────────────────────────────

export interface SpecFile {
  label: string;
  rel: string;
  expect?: string;
  draft?: boolean;
}

export interface CreateSpec {
  files: SpecFile[];
  template?: string;
  system?: string;
  renderer?: string;
  parser?: string;
  requires?: string;
  parameters?: Record<string, unknown>;
  license?: string[];
  messages?: { role: string; content: string }[];
}

/**
 * `checked` is false when nothing can say the files arrived undamaged (a GGUF kit with no checksums
 * file): the import still reads them, but the screen must not show the check as passed.
 */
export type Built = { ok: true; spec: CreateSpec; checked: boolean; warnings: string[] } | { ok: false; errors: string[] };

export const NO_CHECKSUM =
  `This kit has no checksum file, so ${APP_NAME} can't tell whether it was damaged in copying. It will still import it.`;

// ─── Modelfile ──────────────────────────────────────────────────────────────────────────────────────

export interface ModelfileCommand {
  name: string;
  /** PARAMETER's key, MESSAGE's role. */
  key?: string;
  value: string;
  line: number;
}

const KNOWN = new Set(["FROM", "PARAMETER", "TEMPLATE", "SYSTEM", "ADAPTER", "LICENSE", "MESSAGE", "REQUIRES", "RENDERER", "PARSER"]);

/**
 * Ollama's Modelfile syntax: one instruction per line, `#` comments, values bare to the end of the
 * line, in "double quotes", or in """triple quotes""" that may span lines.
 */
export function parseModelfile(text: string): { commands: ModelfileCommand[]; errors: string[] } {
  const commands: ModelfileCommand[] = [];
  const errors: string[] = [];
  const src = text.replace(/\r\n?/g, "\n");
  let i = 0;
  let line = 1;

  const skipBlanks = () => { while (i < src.length && (src[i] === " " || src[i] === "\t")) i++; };
  const toEol = () => { const e = src.indexOf("\n", i); const end = e === -1 ? src.length : e; const s = src.slice(i, end); i = end; return s; };
  const word = () => { const m = /^[^\s]+/.exec(src.slice(i)); const w = m ? m[0] : ""; i += w.length; return w; };
  const value = (): string | null => {
    skipBlanks();
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      if (end === -1) return null;
      const v = src.slice(i + 3, end);
      line += (v.match(/\n/g) ?? []).length;
      i = end + 3;
      toEol();
      return v;
    }
    if (src[i] === '"') {
      let v = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== "\n"; j++) {
        if (src[j] === "\\" && j + 1 < src.length && src[j + 1] !== "\n") { v += src[++j]; continue; }
        if (src[j] === '"') break;
        v += src[j];
      }
      if (src[j] !== '"') return null;
      i = j + 1;
      toEol();
      return v;
    }
    return toEol().trim();
  };

  while (i < src.length) {
    skipBlanks();
    if (src[i] === "\n") { i++; line++; continue; }
    if (i >= src.length) break;
    if (src[i] === "#") { toEol(); continue; }
    const at = line;
    const name = word().toUpperCase();
    if (!KNOWN.has(name)) {
      errors.push(`Line ${at}: "${name}" is not a Modelfile instruction ${APP_NAME} knows.`);
      toEol();
      continue;
    }
    let key: string | undefined;
    if (name === "PARAMETER" || name === "MESSAGE") {
      skipBlanks();
      key = word();
      if (!key) { errors.push(`Line ${at}: ${name} needs a name and a value.`); toEol(); continue; }
    }
    const v = value();
    if (v === null) { errors.push(`Line ${at}: a quote is opened and never closed.`); break; }
    commands.push({ name, key, value: v, line: at });
  }
  return { commands, errors };
}

/** Modelfile PARAMETER values are text; Ollama's options are typed. `stop` may repeat. */
export function typedParameters(cmds: ModelfileCommand[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cmds) {
    if (c.name !== "PARAMETER" || !c.key) continue;
    const k = c.key.toLowerCase();
    const raw = c.value;
    if (k === "stop") { out.stop = [...((out.stop as string[] | undefined) ?? []), raw]; continue; }
    out[k] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === "true" ? true : raw === "false" ? false : raw;
  }
  return out;
}

/** `sha256sum`-style lines (`<hex>  name` or `<hex> *name`) → file name → `sha256:<hex>`. */
export function parseChecksums(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of (text ?? "").split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(l.trim());
    if (m) out.set(m[2].replace(/^\.\//, "").split(/[\\/]/).pop()!, `sha256:${m[1].toLowerCase()}`);
  }
  return out;
}

const basename = (p: string) => p.split("/").pop() ?? p;

/** Turn a GGUF + Modelfile folder into a create request, or say exactly why not. */
export function specFromModelfile(c: Extract<KitCandidate, { kind: "gguf" }>): Built {
  const { commands, errors } = parseModelfile(c.modelfile);
  const froms = commands.filter((x) => x.name === "FROM");
  if (froms.length !== 1) errors.push(froms.length === 0 ? "The Modelfile has no FROM line naming the .gguf file." : "The Modelfile has more than one FROM line.");
  if (commands.some((x) => x.name === "ADAPTER")) errors.push("The Modelfile adds an ADAPTER, which the importer doesn't support yet.");

  const files: SpecFile[] = [];
  if (froms.length === 1) {
    const raw = froms[0].value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
    if (/^([A-Za-z]:|\/|~)/.test(raw) || raw.split("/").includes("..")) {
      errors.push(`FROM points outside this folder (${froms[0].value}). Put the .gguf next to the Modelfile and write FROM ./model.gguf.`);
    } else if (!raw.toLowerCase().endsWith(".gguf")) {
      errors.push(`FROM names "${froms[0].value}", not a .gguf file. The importer needs the model file itself, not the name of a model to download.`);
    } else {
      const want = c.dir ? `${c.dir}/${raw}` : raw;
      const have = (rel: string) => c.ggufs.find((g) => g.rel === rel) ?? c.ggufs.find((g) => g.rel.toLowerCase() === rel.toLowerCase());
      const split = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(want);
      const rels = split
        ? Array.from({ length: Number(split[3]) }, (_, k) => `${split[1]}-${String(k + 1).padStart(5, "0")}-of-${split[3]}.gguf`)
        : [want];
      const sums = parseChecksums(c.checksums);
      for (const rel of rels) {
        const g = have(rel);
        if (!g) { errors.push(`${basename(rel)} is named in the Modelfile but isn't in the folder.`); continue; }
        const expect = sums.get(basename(g.rel));
        // A checksums file that leaves the model out can't vouch for it, and silently skipping the check
        // would read as a pass.
        if (c.checksums !== null && !expect) {
          errors.push(`The checksum file doesn't list ${basename(g.rel)}, so its copy can't be checked. Copy the kit again from the machine that made it.`);
          continue;
        }
        files.push({ label: basename(g.rel), rel: g.rel, ...(expect ? { expect } : {}) });
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const one = (n: string) => commands.filter((x) => x.name === n).pop()?.value;
  const licences = commands.filter((x) => x.name === "LICENSE").map((x) => x.value);
  const messages = commands.filter((x) => x.name === "MESSAGE").map((x) => ({ role: x.key!.toLowerCase(), content: x.value }));
  const parameters = typedParameters(commands);
  const checked = c.checksums !== null;
  return {
    ok: true,
    checked,
    warnings: checked ? [] : [NO_CHECKSUM],
    spec: strip({
      files,
      template: one("TEMPLATE"),
      system: one("SYSTEM"),
      renderer: one("RENDERER"),
      parser: one("PARSER"),
      requires: one("REQUIRES"),
      parameters: Object.keys(parameters).length ? parameters : undefined,
      license: licences.length ? licences : undefined,
      messages: messages.length ? messages : undefined,
    }),
  };
}

const MT = "application/vnd.ollama.image.";

/** Turn an exported Ollama model (manifest + blobs) into a create request. */
export function specFromOllama(c: Extract<KitCandidate, { kind: "ollama" }>): Built {
  const errors: string[] = [];
  const of = (t: string) => c.layers.filter((l) => l.mediaType === MT + t);
  const models = of("model");
  if (models.length === 0) errors.push(`${c.name} has no model file in this folder.`);
  if (models.length > 1) errors.push(`${c.name} is split into several files, which the importer doesn't support yet.`);
  if (of("adapter").length) errors.push(`${c.name} uses an adapter, which the importer doesn't support yet.`);
  const files: SpecFile[] = [];
  const add = (l: KitLayer, label: string, draft = false) => {
    if (!l.rel) errors.push(`A file of ${c.name} is missing from this folder.`);
    else files.push({ label, rel: l.rel, ...(draft ? { draft: true } : {}) });
  };
  if (models.length === 1) add(models[0], "model.gguf");
  of("projector").forEach((l, k) => add(l, k === 0 ? "projector.gguf" : `projector-${k + 1}.gguf`));
  of("draft").forEach((l, k) => add(l, k === 0 ? "draft.gguf" : `draft-${k + 1}.gguf`, true));

  // Rust drops a model whose settings files are damaged or unreadable, so a missing text here is a bug
  // or a mismatched build; say so rather than import a model without its template or licence.
  if (c.layers.some((l) => !l.rel && l.text === null && !["model", "projector", "draft", "adapter"].some((t) => l.mediaType === MT + t))) {
    errors.push(`A settings file of ${c.name} couldn't be read.`);
  }
  const text = (t: string) => of(t).map((l) => l.text).filter((x): x is string => x !== null);
  let parameters: Record<string, unknown> | undefined;
  let messages: { role: string; content: string }[] | undefined;
  try { const p = text("params")[0]; if (p) parameters = JSON.parse(p); } catch { errors.push(`The settings file of ${c.name} is damaged.`); }
  try { const m = text("messages")[0]; if (m) messages = JSON.parse(m); } catch { errors.push(`The example messages of ${c.name} are damaged.`); }
  let config: { renderer?: unknown; parser?: unknown; requires?: unknown } = {};
  try { if (c.config) config = JSON.parse(c.config); } catch { errors.push(`The settings of ${c.name} are damaged.`); }
  if (errors.length) return { ok: false, errors };

  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const licences = text("license");
  return {
    ok: true,
    // Every blob's own name is its checksum, so an Ollama export is always checkable.
    checked: true,
    warnings: [],
    spec: strip({
      files,
      template: text("template")[0],
      system: text("system")[0],
      renderer: str(config.renderer),
      parser: str(config.parser),
      requires: str(config.requires),
      parameters: parameters && Object.keys(parameters).length ? parameters : undefined,
      license: licences.length ? licences : undefined,
      messages: messages?.length ? messages : undefined,
    }),
  };
}

export function specFor(c: KitCandidate): Built {
  return c.kind === "gguf" ? specFromModelfile(c) : specFromOllama(c);
}

// ─── licences ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether Google's Gemma Terms of Use cover this model. They cover Gemma 1 to 3 (and 3n). Gemma 4 and
 * later are Apache 2.0, so their licence travels like any other: a mention of `gemma4` (or a higher
 * number) anywhere in the name, family or files means not covered.
 */
export function gemmaTermsApply(text: string): boolean {
  const versions = [...text.toLowerCase().matchAll(/gemma[-_ ]?(\d*)/g)].map((m) => (m[1] ? Number(m[1]) : 0));
  return versions.length > 0 && versions.every((v) => v < 4);
}

export function isGemma(c: KitCandidate): boolean {
  const hay = c.kind === "ollama"
    ? `${c.name} ${c.config ?? ""}`
    : `${c.dir} ${c.ggufs.map((g) => g.rel).join(" ")} ${c.modelfile}`;
  return gemmaTermsApply(hay);
}

export interface LicenceNote { tone: "ok" | "warning"; text: string }

/**
 * What the screen says about this model's licence: the files found next to it (Rust looks only beside
 * that model and in the kit's `licences/<model>` folder), and for Gemma 1-3, whether Google's Terms of Use
 * and Prohibited Use Policy came along. A reminder, never a block.
 */
export function licenceNotes(c: KitCandidate, built: Built | null): LicenceNote[] {
  const files = c.licenceFiles.map(basename);
  const embedded = built?.ok ? built.spec.license?.length ?? 0 : 0;
  const notes: LicenceNote[] = [
    files.length
      ? { tone: "ok", text: `Travels with it: ${files.join(", ")}` }
      : embedded
        ? { tone: "ok", text: "Travels with it, inside the model" }
        : { tone: "warning", text: "No licence or terms file found next to this model. Keep the model's licence with the kit." },
  ];
  if (isGemma(c)) {
    const has = (re: RegExp) => files.some((f) => re.test(f));
    notes.push(has(/terms/i) && has(/prohibited/i)
      ? { tone: "ok", text: "Gemma's Terms of Use and Prohibited Use Policy are with it." }
      : { tone: "warning", text: "This is a Gemma model. Google's Gemma Terms of Use and Prohibited Use Policy must go with it wherever it goes, and they aren't next to it. Add both before you pass the kit on." });
  }
  return notes;
}

function strip(spec: CreateSpec): CreateSpec {
  return Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) as unknown as CreateSpec;
}

// ─── names, sizes, versions ─────────────────────────────────────────────────────────────────────────

/** Same rule as `valid_model_name` in model_import.rs. */
export function validModelName(name: string): boolean {
  const part = (s: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(s);
  const [path, ...tags] = name.split(":");
  if (tags.length > 1) return false;
  const segs = path.split("/");
  return segs.length <= 2 && segs.every(part) && (tags.length === 0 || part(tags[0]));
}

/** Ollama treats `x` and `x:latest` as one model. */
export function nameTaken(name: string, installed: string[]): boolean {
  const norm = (n: string) => { const t = n.trim().toLowerCase(); return t.includes(":") ? t : `${t}:latest`; };
  return installed.some((m) => norm(m) === norm(name));
}

/** A problem with a typed name, in plain words, or null when it's fine. */
export function nameProblem(name: string, installed: string[]): string | null {
  const n = name.trim();
  if (!n) return "Give the model a name.";
  if (!validModelName(n)) return "Use letters, numbers, dots and dashes, with one colon before a tag (like my-model:small).";
  if (nameTaken(n, installed)) return `This computer already has a model called ${n}. Pick another name; nothing gets replaced.`;
  return null;
}

/** The name a candidate suggests: its own for an Ollama export, the folder's for a GGUF. */
export function suggestedName(c: KitCandidate): string {
  if (c.kind === "ollama") return c.name;
  const base = (c.dir.split("/").pop() || c.ggufs[0]?.rel.split("/").pop()?.replace(/\.gguf$/i, "") || "imported-model")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|-+$/g, "");
  return base || "imported-model";
}

export function candidateBytes(c: KitCandidate): number {
  return c.kind === "gguf" ? c.ggufs.reduce((a, g) => a + g.bytes, 0) : c.layers.reduce((a, l) => a + (l.rel ? l.size : 0), 0);
}

/** True when the model says it needs a newer Ollama than this one. Unknown versions never block. */
export function needsNewerOllama(requires: string | undefined, have: string | null): boolean {
  if (!requires || !have) return false;
  return compareVersions(have, requires) < 0;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} bytes`;
}

/** Same rule as `space_problem` in model_import.rs: the model plus 1 GB kept spare. */
export const SPARE_BYTES = 1024 ** 3;
export function hasRoom(need: number, free: number | null): boolean | null {
  return free === null ? null : free >= need + SPARE_BYTES;
}

// ─── progress ───────────────────────────────────────────────────────────────────────────────────────

export type ImportPhase = "checking" | "verifying" | "copying" | "finishing";

export type ImportEvent =
  | { kind: "phase"; phase: ImportPhase; total: number }
  | { kind: "bytes"; phase: ImportPhase; done: number; total: number; file: string }
  | { kind: "skipped"; file: string; bytes: number }
  | { kind: "unchecked"; file: string }
  | { kind: "status"; text: string };

/**
 * Each file is read twice: once to check it isn't damaged, once to hand it to Ollama. Both passes are
 * the same bytes, so they get equal halves of the bar; the bookends are short.
 */
const SPAN: Record<ImportPhase, [number, number]> = {
  checking: [0, 0.02],
  verifying: [0.02, 0.5],
  copying: [0.5, 0.97],
  finishing: [0.97, 1],
};

export function importFraction(phase: ImportPhase, done: number, total: number): number {
  const [a, b] = SPAN[phase];
  const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return a + (b - a) * (phase === "checking" || phase === "finishing" ? 0 : f);
}

/** Seconds left at the current rate, or null until there's enough to go on. */
export function etaSeconds(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0 || elapsedMs < 2000 || done >= total) return null;
  return Math.round(((total - done) / done) * (elapsedMs / 1000));
}

export function formatEta(s: number | null): string {
  if (s === null) return "";
  if (s < 60) return "less than a minute left";
  const m = Math.round(s / 60);
  return m === 1 ? "about a minute left" : `about ${m} minutes left`;
}

export const PHASE_LABEL: Record<ImportPhase, string> = {
  checking: "Checking there's room",
  verifying: "Checking the files aren't damaged",
  copying: "Copying the model into Ollama",
  finishing: "Ollama is getting the model ready",
};
