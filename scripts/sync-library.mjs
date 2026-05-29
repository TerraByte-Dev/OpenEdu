#!/usr/bin/env node
// Refresh the BUNDLED library (public/library/) from the sibling authoring repo (../openedu-library).
// The app ships this vendored copy so the curated library works fully offline with zero deploy. Re-run
// after editing cards/assets in openedu-library (and after `node scripts/build-assets.mjs` there):
//
//   npm run sync:library
//
// Not wired into prebuild on purpose — the committed copy is the source of truth at build time, so CI /
// other machines don't need the sibling repo present.
import { cp, rm, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(APP_ROOT, "..", "openedu-library");
const DEST = join(APP_ROOT, "public", "library");

try {
  await access(SRC);
} catch {
  console.error(`sync-library: source repo not found at ${SRC}\n  → clone TerraByte-Dev/openedu-library next to this app, or edit the bundled copy directly.`);
  process.exit(1);
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });
for (const item of ["index.json", "resources", "assets"]) {
  await cp(join(SRC, item), join(DEST, item), { recursive: true });
}
console.log(`sync-library: refreshed public/library/ from ${SRC}`);
