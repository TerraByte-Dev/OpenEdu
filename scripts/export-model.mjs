#!/usr/bin/env node
// Copy a model this machine's Ollama already has into an offline kit folder (issue #275).
//
// The kit goes on a USB stick; OpenEdu on a machine with no internet imports it from Settings › Models
// or the first-run setup screen. The layout is described in docs/OFFLINE-KIT.md.
//
//   node scripts/export-model.mjs <model> <kit-folder> [--layout ollama|gguf] [--models-dir <dir>]
//
//   node scripts/export-model.mjs qwen3.5:0.8b E:\OpenEdu-Kit
//   node scripts/export-model.mjs gemma4:e2b /Volumes/KIT --layout ollama
//
// Layouts (both import the same way):
//   ollama (default)  <kit>/models/manifests/<host>/<ns>/<name>/<tag> + <kit>/models/blobs/sha256-…
//                     A byte-for-byte copy of what Ollama stores. Works for every model, including ones
//                     with a vision projector or a draft model (gemma4).
//   gguf              <kit>/models/<name>/model.gguf + Modelfile + checksums.sha256
//                     The open format, usable outside Ollama too. Single-file models only.
// Either way the model's licence text from Ollama is written to <kit>/models/licences/<name>/.
//
// Read-only on the source: the Ollama store is only ever opened for reading, and the script refuses a
// kit folder inside it. It does not need Ollama to be running. Every file is hashed as it is copied and
// checked against the digest Ollama recorded, so a kit that finishes is a kit that verifies. Re-running
// skips files already copied intact, so an interrupted copy can be resumed.
//
// No model or installer is ever committed to this repo; the kit is made on the machine that has them.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, isAbsolute } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MT = "application/vnd.ollama.image.";
const WEIGHTS = ["model", "projector", "draft", "adapter"].map((t) => MT + t);
const TEXT = ["template", "system", "params", "license", "messages"].map((t) => MT + t);

function fail(msg) {
  console.error(`\n  ✕ ${msg}\n`);
  process.exit(1);
}

function args(argv) {
  const out = { layout: "ollama", modelsDir: null, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--layout") out.layout = argv[++i];
    else if (a === "--models-dir") out.modelsDir = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else out.pos.push(a);
  }
  return out;
}

/** Where Ollama keeps models: OLLAMA_MODELS, the Linux service home, or ~/.ollama/models. */
function ollamaModelsDir(flag) {
  if (flag) return flag;
  if (process.env.OLLAMA_MODELS) return process.env.OLLAMA_MODELS;
  const service = "/usr/share/ollama/.ollama/models";
  if (process.platform === "linux" && existsSync(service)) return service;
  return join(homedir(), ".ollama", "models");
}

/** `[host/][namespace/]name[:tag]` → the four manifest path parts, as Ollama resolves them. Each part
 * becomes a folder name under the store, so anything but letters, digits, `.`, `_` and `-` (and `.` or
 * `..` on their own) is refused before it can name a path. */
export function parseRef(ref) {
  const parts = parseRefParts(ref);
  for (const p of parts) {
    if (!/^[A-Za-z0-9._-]+$/.test(p) || p === "." || p === "..") throw new Error(`"${ref}" is not a model name`);
  }
  return parts;
}

function parseRefParts(ref) {
  const [path, tag = "latest"] = ref.includes(":") && !ref.slice(ref.lastIndexOf(":")).includes("/")
    ? [ref.slice(0, ref.lastIndexOf(":")), ref.slice(ref.lastIndexOf(":") + 1)]
    : [ref, "latest"];
  const segs = path.split("/");
  if (segs.length === 1) return ["registry.ollama.ai", "library", segs[0], tag];
  if (segs.length === 2) return ["registry.ollama.ai", segs[0], segs[1], tag];
  if (segs.length === 3) return [segs[0], segs[1], segs[2], tag];
  throw new Error(`"${ref}" is not a model name`);
}

const blobName = (digest) => {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`malformed digest ${digest}`);
  return digest.replace(":", "-");
};
const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);
const safeName = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

async function sha256(file) {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return `sha256:${h.digest("hex")}`;
}

/** Copy `src` to `dest`, hashing on the way, and only keep it if the hash is `digest`. */
async function copyVerified(src, dest, digest, label) {
  const size = statSync(src).size;
  if (existsSync(dest) && statSync(dest).size === size && (await sha256(dest)) === digest) {
    console.log(`    = ${label} (${gb(size)}) already in the kit, intact`);
    return { size, copied: false };
  }
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  rmSync(tmp, { force: true });
  const h = createHash("sha256");
  let done = 0;
  let shown = 0;
  await pipeline(
    createReadStream(src, { flags: "r", highWaterMark: 4 << 20 }),
    new Transform({
      transform(chunk, _e, cb) {
        h.update(chunk);
        done += chunk.length;
        if (process.stdout.isTTY && (done - shown > 64 << 20 || done === size)) {
          shown = done;
          process.stdout.write(`\r    → ${label} ${Math.round((done / size) * 100)}%   `);
        }
        cb(null, chunk);
      },
    }),
    createWriteStream(tmp, { flags: "wx" }),
  );
  const got = `sha256:${h.digest("hex")}`;
  if (got !== digest) {
    rmSync(tmp, { force: true });
    throw new Error(`${label} did not copy cleanly (expected ${digest}, got ${got}). Check the stick and run again.`);
  }
  renameSync(tmp, dest);
  if (process.stdout.isTTY) process.stdout.write("\r");
  console.log(`    ✓ ${label} (${gb(size)}) copied and verified`);
  return { size, copied: true };
}

/**
 * A Modelfile value in triple quotes: newlines, backslashes and inner quotes are kept literally. A value
 * containing `"""`, or starting or ending with `"`, can't be told apart from its own quotes, so it is
 * refused rather than written wrong; `--layout ollama` keeps such a model byte for byte.
 */
export function quoteModelfileValue(s, what) {
  if (s.includes('"""') || s.startsWith('"') || s.endsWith('"')) {
    throw new Error(`the model's ${what} starts or ends with a quote mark, which a Modelfile can't hold. Use --layout ollama for this model.`);
  }
  return `"""${s}"""`;
}

/** Modelfile text from a manifest's layers. Every text value goes through quoteModelfileValue. */
export function modelfileFor(layers, readText, config) {
  const q = quoteModelfileValue;
  const lines = ["# Written by OpenEdu scripts/export-model.mjs from Ollama's own copy of this model.", "FROM ./model.gguf"];
  for (const l of layers) {
    const t = l.mediaType.slice(MT.length);
    if (t === "template") lines.push(`TEMPLATE ${q(readText(l), "template")}`);
    if (t === "system") lines.push(`SYSTEM ${q(readText(l), "system prompt")}`);
    if (t === "params") {
      for (const [k, v] of Object.entries(JSON.parse(readText(l)))) {
        for (const one of Array.isArray(v) ? v : [v]) lines.push(`PARAMETER ${k} ${typeof one === "string" ? q(one, `${k} setting`) : one}`);
      }
    }
    if (t === "messages") for (const m of JSON.parse(readText(l))) lines.push(`MESSAGE ${m.role} ${q(m.content, "example message")}`);
    if (t === "license") lines.push(`LICENSE ${q(readText(l), "licence")}`);
  }
  for (const k of ["renderer", "parser", "requires"]) if (typeof config[k] === "string" && config[k]) lines.push(`${k.toUpperCase()} ${config[k]}`);
  return `${lines.join("\n")}\n`;
}

/** The real path of `p`, resolved through its nearest existing ancestor (junctions and symlinks
 * included), with the parts that don't exist yet appended. `p` itself need not exist. */
export function realish(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync.native(cur), ...rest);
}

const within = (child, parent) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** Why a kit folder can't be used with this store, or null. Each side is given in every form it has:
 * as typed and as real (see realish). A junction can make them differ, e.g. ~/.ollama/models really on
 * D:, so every pair is checked. The kit's `models` folder must not be, or be inside, the store, and the
 * store must not be inside the kit: either way the export would write into Ollama's own files or around
 * them. */
export function kitProblem(stores, kits) {
  for (const store of stores) {
    for (const kit of kits) {
      if (within(join(kit, "models"), store)) return "The kit folder is inside Ollama's model store. Pick a folder outside it.";
      if (within(store, kit)) return "Ollama's model store is inside the kit folder. Pick a kit folder that doesn't contain it.";
    }
  }
  return null;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.help || a.pos.length !== 2) {
    console.log("Usage: node scripts/export-model.mjs <model> <kit-folder> [--layout ollama|gguf] [--models-dir <dir>]");
    process.exit(a.help ? 0 : 1);
  }
  if (!["ollama", "gguf"].includes(a.layout)) fail(`--layout must be ollama or gguf, not ${a.layout}`);
  const [ref, kitArg] = a.pos;
  const store = resolve(ollamaModelsDir(a.modelsDir));
  if (!existsSync(join(store, "manifests"))) fail(`No Ollama models found in ${store}. Set --models-dir or OLLAMA_MODELS.`);
  const kit = resolve(kitArg);
  // Checked before anything is created, against the real paths a junction or symlink would lead to.
  const problem = kitProblem([store, realish(store)], [kit, realish(kit)]);
  if (problem) fail(problem);
  let parts;
  try { parts = parseRef(ref); } catch (e) { fail(e.message); }
  mkdirSync(kit, { recursive: true });

  const manifestPath = join(store, "manifests", ...parts);
  if (!existsSync(manifestPath)) fail(`Ollama doesn't have ${ref} here (looked for ${manifestPath}). Run \`ollama list\` to see names.`);
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const blob = (d) => join(store, "blobs", blobName(d));
  const readText = (l) => readFileSync(blob(l.digest), "utf8");
  const config = manifest.config ? JSON.parse(readFileSync(blob(manifest.config.digest), "utf8")) : {};
  const name = `${parts[2]}:${parts[3]}`;
  const started = Date.now();
  console.log(`\n  Exporting ${ref} from ${store}\n  into ${kit} (${a.layout} layout)\n`);

  for (const l of manifest.layers) {
    if ((WEIGHTS.includes(l.mediaType) || TEXT.includes(l.mediaType)) && !existsSync(blob(l.digest))) {
      fail(`A file of ${ref} is missing from Ollama's store (${blobName(l.digest)}). Run \`ollama pull ${ref}\` and try again.`);
    }
  }

  let total = 0;
  if (a.layout === "ollama") {
    const out = join(kit, "models");
    for (const d of [manifest.config, ...manifest.layers].filter(Boolean)) {
      if (!existsSync(blob(d.digest))) {
        console.log(`    – ${d.mediaType} ${blobName(d.digest).slice(0, 19)}… is a reference Ollama doesn't keep locally; not needed to import`);
        continue;
      }
      const r = await copyVerified(blob(d.digest), join(out, "blobs", blobName(d.digest)), d.digest, `${d === manifest.config ? "config" : d.mediaType.split(".").pop()} ${blobName(d.digest).slice(0, 19)}…`);
      total += r.size;
    }
    const mdest = join(out, "manifests", ...parts);
    mkdirSync(dirname(mdest), { recursive: true });
    writeFileSync(mdest, manifestText);
    console.log(`    ✓ manifest ${relative(kit, mdest)}`);
  } else {
    const weights = manifest.layers.filter((l) => WEIGHTS.includes(l.mediaType));
    if (weights.length !== 1 || weights[0].mediaType !== `${MT}model`) {
      fail(`${ref} has ${weights.length} weight files (a vision projector or a draft model). A Modelfile can name only one; use --layout ollama.`);
    }
    const dir = join(kit, "models", safeName(`${parts[2]}-${parts[3]}`));
    total += (await copyVerified(blob(weights[0].digest), join(dir, "model.gguf"), weights[0].digest, "model.gguf")).size;
    writeFileSync(join(dir, "Modelfile"), modelfileFor(manifest.layers, readText, config));
    writeFileSync(join(dir, "checksums.sha256"), `${weights[0].digest.slice(7)}  model.gguf\n`);
    console.log(`    ✓ Modelfile and checksums.sha256 in ${relative(kit, dir)}`);
  }

  const licences = manifest.layers.filter((l) => l.mediaType === `${MT}license`);
  const ldir = join(kit, "models", "licences", safeName(`${parts[2]}-${parts[3]}`));
  mkdirSync(ldir, { recursive: true });
  licences.forEach((l, i) => writeFileSync(join(ldir, licences.length === 1 ? "LICENSE.txt" : `LICENSE-${i + 1}.txt`), readText(l)));
  for (const d of ["ollama", "openedu"]) mkdirSync(join(kit, d), { recursive: true });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  Done: ${name}, ${gb(total)} in ${secs}s. Licence text: ${licences.length ? relative(kit, ldir) : "none in Ollama's copy"}.`);
  const family = `${config.model_family ?? ""} ${parts[2]}`.toLowerCase();
  // Google's Gemma Terms cover Gemma 1-3 (and 3n); Gemma 4 and later are Apache 2.0 (model-kit.ts gemmaTermsApply).
  const gemmaVersions = [...family.matchAll(/gemma[-_ ]?(\d*)/g)].map((m) => (m[1] ? Number(m[1]) : 0));
  if (gemmaVersions.length && gemmaVersions.every((v) => v < 4)) {
    console.log(
      "\n  ! Gemma: the Gemma Terms of Use require that the Terms and the Prohibited Use Policy travel with the model." +
        `\n    Save both into ${ldir}:` +
        "\n      https://ai.google.dev/gemma/terms" +
        "\n      https://ai.google.dev/gemma/prohibited_use_policy",
    );
  } else {
    console.log("\n  Check the model's licence before you hand the kit to anyone; some require more files than Ollama keeps.");
  }
  console.log(`  Still to add by hand: Ollama's installer in ${join(kit, "ollama")}, OpenEdu's installer in ${join(kit, "openedu")}.\n`);
}

if (process.argv[1]?.endsWith("export-model.mjs")) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
