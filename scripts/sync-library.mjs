#!/usr/bin/env node
// Refresh the BUNDLED library (public/library/) from the sibling authoring repo (../openedu-library).
// The app ships this vendored copy so the curated library works fully offline with zero deploy. Re-run
// after editing cards/assets in openedu-library (and after `node scripts/build-assets.mjs` there):
//
//   npm run sync:library
//
// Not wired into prebuild on purpose — the committed copy is the source of truth at build time, so CI /
// other machines don't need the sibling repo present.
//
// INCREMENTAL, IN-PLACE refresh: we copy a file ONLY when its bytes actually differ from the bundled copy,
// then prune files that no longer exist in SRC. Two reasons this matters with a running Vite dev server:
//   1. Never `rm -rf` the publicDir — deleting + recreating a watched folder corrupts Vite's view (new
//      subdirs 404 to the SPA fallback → blank cards) and can fire a reload storm.
//   2. Only rewrite changed files — Vite watches public/library, so a touched file triggers a full-page
//      reload. Writing only real changes means a no-op sync reloads nothing, and a content sync reloads
//      just the cards that changed (which are then served live; an in-app reload shows them).
import { rm, mkdir, access, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(APP_ROOT, "..", "openedu-library");
const DEST = join(APP_ROOT, "public", "library");
const ITEMS = ["index.json", "resources", "assets", "datasets"];

try {
  await access(SRC);
} catch {
  console.error(`sync-library: source repo not found at ${SRC}\n  → clone TerraByte-Dev/openedu-library next to this app, or edit the bundled copy directly.`);
  process.exit(1);
}

// Recursively list files under `root` as POSIX-relative paths.
async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing dir → nothing to list
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(relative(root, abs).split(sep).join("/"));
    }
  }
  await walk(root);
  return out;
}

// Copy src → dest only if the bytes differ (or dest is missing). Returns true if it wrote.
async function copyIfChanged(src, dest) {
  const srcBuf = await readFile(src);
  try {
    const destBuf = await readFile(dest);
    if (srcBuf.equals(destBuf)) return false; // identical — leave it (no spurious reload)
  } catch { /* dest missing → write it */ }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, srcBuf);
  return true;
}

await mkdir(DEST, { recursive: true });

// 1. Copy changed files in place (creates new files/dirs; never nukes DEST).
let written = 0;
for (const item of ITEMS) {
  const srcItem = join(SRC, item);
  if ((await stat(srcItem)).isFile()) {
    if (await copyIfChanged(srcItem, join(DEST, item))) written++;
    continue;
  }
  for (const rel of await listFiles(srcItem)) {
    if (await copyIfChanged(join(srcItem, rel), join(DEST, item, rel))) written++;
  }
}

// 2. Prune DEST files that no longer exist in SRC (propagate renames/removals), scoped to the managed dirs.
let pruned = 0;
for (const item of ITEMS) {
  if (item === "index.json") continue;
  const srcSet = new Set(await listFiles(join(SRC, item)));
  for (const rel of await listFiles(join(DEST, item))) {
    if (!srcSet.has(rel)) {
      await rm(join(DEST, item, rel));
      pruned++;
    }
  }
}

console.log(`sync-library: ${written} file(s) updated, ${pruned} pruned — in place, from ${SRC}`);
console.log("  ↳ dev server running? changes are picked up live (reload with Ctrl+R); restart only if you added a NEW subject folder.");
