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
// IN-PLACE refresh (no `rm -rf DEST`): we copy/overwrite each managed item and then prune files that no
// longer exist in SRC. Why it matters: when a Vite dev server is running, deleting + recreating the whole
// publicDir makes Vite lose track of it — newly-added subdirectories then 404 to the SPA fallback (cards
// render blank) until the dev server restarts, and the delete/recreate churn can fire a reload storm.
// An in-place update keeps existing directories stable, so a simple in-app reload picks up the changes.
// (public/library is also excluded from Vite's watcher in vite.config.ts so a sync never reload-storms.)
import { cp, rm, mkdir, access, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
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

// Recursively list files under `root` as POSIX-relative paths (dirs themselves are implied by their files).
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

await mkdir(DEST, { recursive: true });

// 1. Copy/overwrite every managed item from SRC over DEST (creates new files/dirs in place; never nukes DEST).
for (const item of ITEMS) {
  await cp(join(SRC, item), join(DEST, item), { recursive: true, force: true });
}

// 2. Prune DEST files that no longer exist in SRC (so renames/removals propagate), scoped to the managed
//    directories. index.json is a single file that's always overwritten in step 1.
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

console.log(`sync-library: refreshed public/library/ from ${SRC}${pruned ? ` (pruned ${pruned} stale file(s))` : ""}`);
console.log("  ↳ dev server running? reload the app (Ctrl+R) to see it; restart the dev server if you ADDED a new subject folder.");
