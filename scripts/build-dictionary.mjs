#!/usr/bin/env node
// Build the bundled offline dictionary (public/dictionary/) from Open English WordNet (issue #251).
//
// Inputs are the two OEWN 2025 release archives (the 2025 edition, without the proper nouns that
// "2025+" adds), unzipped by hand:
//
//   gh release download 2025-edition -R globalwordnet/english-wordnet \
//     -p english-wordnet-2025-json.zip -p english-wordnet-2025.zip
//   unzip english-wordnet-2025-json.zip -d json && unzip english-wordnet-2025.zip -d wndb
//   node scripts/build-dictionary.mjs json wndb/oewn2025
//
// The sha256 of each archive is pinned below and written into meta.json. Rebuilding from the same
// archives gives byte-identical output (keys and senses are emitted in a fixed order).
//
// What it writes:
//   public/dictionary/<xx>.json   one shard per two-letter prefix of the lowercased headword:
//                                 { "<headword>": [[form, pos, definition, example, synonyms], ...] }
//                                 pos is n | v | a | r; senses keep OEWN's order within a headword.
//   public/dictionary/exceptions.json   irregular forms from WNDB *.exc: { n|v|a|r: { form: [lemma] } }
//   public/dictionary/meta.json   source, edition, licence, what was changed, archive hashes, counts,
//                                 and the list of shard keys (lookups fetch only those)
//   public/dictionary/LICENSE.md, WNDB_License.txt   OEWN's licence texts (CC BY 4.0, and the
//                                 Princeton WordNet licence), copied from scripts/data/oewn/, which holds
//                                 them as fetched from the repo at the 2025-edition tag
//
// Re-run only to move to a new OEWN edition; the committed output is the source of truth at build time.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EDITION = "2025";
const ARCHIVE_SHA256 = {
  "english-wordnet-2025-json.zip": "7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51",
  "english-wordnet-2025.zip": "73355e48f8117a24ca9ebc23ed75b35434e6cd21cc9dd3984e80aff5a5f63636",
};
/** One-word synonyms kept per sense: enough for "big: large, great". Multiword members ("banking
 *  concern") cost 0.3 MB compressed and rarely help a child. */
const MAX_SYNONYMS = 3;

const [jsonDir, wndbDir] = process.argv.slice(2);
if (!jsonDir || !wndbDir) {
  console.error("usage: node scripts/build-dictionary.mjs <oewn-json-dir> <oewn-wndb-dir>");
  process.exit(1);
}
const APP_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(APP_ROOT, "public", "dictionary");

/** Same rule as shardKey in src/lib/dictionary.ts; a test pins the two together. */
function shardKey(headword) {
  const c = (i) => (/[a-z0-9]/.test(headword[i] ?? "") ? headword[i] : "_");
  return c(0) + c(1);
}

const files = readdirSync(jsonDir).sort();
const synsets = new Map();
for (const f of files.filter((f) => /^(noun|verb|adj|adv)\..*\.json$/.test(f))) {
  for (const [id, s] of Object.entries(JSON.parse(readFileSync(join(jsonDir, f), "utf8")))) synsets.set(id, s);
}
const entries = new Map();
for (const f of files.filter((f) => /^entries-.*\.json$/.test(f))) {
  for (const [lemma, e] of Object.entries(JSON.parse(readFileSync(join(jsonDir, f), "utf8")))) entries.set(lemma, e);
}

// Group the case variants of a headword ("may", "May"), lowercase variant first, then by code point.
const byKey = new Map();
for (const lemma of entries.keys()) {
  const key = lemma.toLowerCase();
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(lemma);
}
const rank = (form) => (form === form.toLowerCase() ? 0 : 1);
const shards = new Map();
let senseCount = 0;
for (const key of [...byKey.keys()].sort()) {
  const forms = byKey.get(key).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const rows = [];
  for (const form of forms) {
    for (const [posKey, e] of Object.entries(entries.get(form))) {
      const pos = posKey[0] === "s" ? "a" : posKey[0]; // satellite adjectives are adjectives
      for (const sense of e.sense) {
        const s = synsets.get(sense.synset);
        if (!s) throw new Error(`missing synset ${sense.synset} for ${form}`);
        const ex = (s.example ?? [])[0];
        const example = typeof ex === "string" ? ex : (ex?.text ?? "");
        const synonyms = (s.members ?? [])
          .filter((m) => m.toLowerCase() !== key && !m.includes(" "))
          .slice(0, MAX_SYNONYMS);
        rows.push([form, pos, s.definition[0], example, synonyms]);
        senseCount++;
      }
    }
  }
  const sk = shardKey(key);
  if (!shards.has(sk)) shards.set(sk, {});
  shards.get(sk)[key] = rows;
}

const exceptions = { n: {}, v: {}, a: {}, r: {} };
for (const [file, pos] of [["noun.exc", "n"], ["verb.exc", "v"], ["adj.exc", "a"], ["adv.exc", "r"]]) {
  for (const line of readFileSync(join(wndbDir, file), "utf8").split(/\r?\n/)) {
    const [form, ...lemmas] = line.trim().split(/\s+/);
    if (!form || lemmas.length === 0) continue;
    // A form can sit on several lines ("better good", "better well"): accumulate, don't overwrite.
    const list = (exceptions[pos][form.replace(/_/g, " ")] ??= []);
    for (const l of lemmas.map((l) => l.replace(/_/g, " "))) if (!list.includes(l)) list.push(l);
  }
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const [sk, obj] of [...shards.entries()].sort()) writeFileSync(join(OUT, `${sk}.json`), JSON.stringify(obj));
writeFileSync(join(OUT, "exceptions.json"), JSON.stringify(exceptions));
for (const f of ["LICENSE.md", "WNDB_License.txt"]) copyFileSync(join(APP_ROOT, "scripts", "data", "oewn", f), join(OUT, f));
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify(
    {
      source: "Open English WordNet",
      edition: EDITION,
      url: "https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition",
      license: "CC BY 4.0 (Open English WordNet) and the Princeton WordNet licence; see LICENSE.md and WNDB_License.txt",
      attribution: "Open English WordNet, by the Open English WordNet team, derived from Princeton WordNet.",
      archives: ARCHIVE_SHA256,
      headwords: byKey.size,
      senses: senseCount,
      modifications:
        "Adapted: reformatted into JSON shards by two-letter prefix; per sense, the first definition, the " +
        "first example and up to 3 one-word synonyms; relations, pronunciations and other fields dropped.",
      shardKeys: [...shards.keys()].sort(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`dictionary: ${byKey.size} headwords, ${senseCount} senses, ${shards.size} shards -> ${OUT}`);
