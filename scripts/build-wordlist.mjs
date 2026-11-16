#!/usr/bin/env node
// Build the bundled English word list (public/wordlist/) from the word-list npm package (MIT), which
// is already installed as a devDependency: no download.
//
//   npm ci && node scripts/build-wordlist.mjs
//
// The written-answer grader (quiz.ts misspellingNotes) asks it one thing: is this word a real English
// word? WordNet (public/dictionary/) lacks many real words (chalcogens, voltammeter, granivore), and an
// answer that is a real word is never noted as a misspelling of the key.
//
// What it writes:
//   public/wordlist/<xx>.json   one shard per two-letter prefix: a JSON string, the words joined by
//                               single spaces, in the package's order
//   public/wordlist/meta.json   the package, its version, the sha256 of its words.txt, the word count
//                               and the list of shard keys (lookups fetch only those)
//   public/wordlist/LICENSE     the package's licence text
//
// The sha256 of words.txt is pinned below: a different file (another package version) stops the build
// until the pin is changed on purpose. The same words.txt gives byte-identical output.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "4.1.0";
const WORDS_SHA256 = "2df02fa8ed82d465482ae40c4f9cb52a713baa1d3bfdce1acb2a5fe30420eea8";

const APP_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PKG = dirname((await import("word-list")).default);
const OUT = join(APP_ROOT, "public", "wordlist");

const version = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
if (version !== VERSION) throw new Error(`word-list is ${version}, this script is pinned to ${VERSION}`);
const raw = readFileSync(join(PKG, "words.txt"));
const sha256 = createHash("sha256").update(raw).digest("hex");
if (sha256 !== WORDS_SHA256) throw new Error(`words.txt sha256 is ${sha256}, expected ${WORDS_SHA256}`);

const words = raw.toString("utf8").split("\n").filter(Boolean);
const bad = words.find((w) => !/^[a-z]{2,}$/.test(w));
if (bad !== undefined) throw new Error(`unexpected entry in words.txt: ${JSON.stringify(bad)}`);

const shards = new Map();
for (const w of words) {
  const key = w.slice(0, 2);
  if (!shards.has(key)) shards.set(key, []);
  shards.get(key).push(w);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const keys = [...shards.keys()].sort();
for (const k of keys) writeFileSync(join(OUT, `${k}.json`), JSON.stringify(shards.get(k).join(" ")));
copyFileSync(join(PKG, "license"), join(OUT, "LICENSE"));
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify({
    source: "word-list (npm), by Sindre Sorhus",
    version: VERSION,
    url: "https://github.com/sindresorhus/word-list",
    license: "MIT; see LICENSE",
    file: "words.txt",
    sha256: WORDS_SHA256,
    words: words.length,
    shardKeys: keys,
  }, null, 2) + "\n",
);
console.log(`Wrote public/wordlist/: ${words.length} words in ${keys.length} shards.`);
