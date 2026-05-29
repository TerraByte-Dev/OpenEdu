// Dev-only helpers for the OpenEdu Library — registered only in `tauri dev` (see main.tsx). They let
// you verify retrieval WITHOUT the live host deployed, since matching is pure/client-side:
//
//   __testLibraryMatch("show me the periodic table")  // rank a query against a sample manifest
//   __libraryStatus()                                  // is a real manifest cached? how many entries?
//
// __testLibraryMatch exercises the exact lexical scorer the tool uses; __libraryStatus reflects the
// real in-memory cache hydrated from the network/persisted copy.

import { matchResources, isLibraryAvailable, getManifest } from "./library";
import type { LibraryEntry } from "../types";

// A stand-in manifest mirroring the seed cards in the openedu-library repo, so matching can be checked
// before the static host is deployed. Not the source of truth — the deployed index.json is.
const SAMPLE_MANIFEST: LibraryEntry[] = [
  {
    id: "chemistry/periodic-table",
    title: "Periodic Table of the Elements",
    aliases: ["periodic table", "table of elements", "element table", "periodic table of elements"],
    tags: ["chemistry", "elements", "atomic number", "atomic mass", "symbol"],
    subject: "chemistry",
    summary: "Elements with their symbol, atomic number, and atomic mass; plus how the table is organized.",
    path: "resources/chemistry/periodic-table.md",
  },
  {
    id: "math/unit-circle",
    title: "Unit Circle",
    aliases: ["unit circle", "trig circle", "trigonometric circle"],
    tags: ["math", "trigonometry", "sine", "cosine", "tangent", "radians", "degrees"],
    subject: "math",
    summary: "Common angles on the unit circle with their radian measure and exact sin/cos/tan values.",
    path: "resources/math/unit-circle.md",
  },
];

function testLibraryMatch(query: string): LibraryEntry[] {
  const ranked = matchResources(query, SAMPLE_MANIFEST, 3);
  console.log(`[library] "${query}" →`, ranked.length ? ranked.map((r) => r.title).join(" | ") : "(no match)");
  return ranked;
}

async function libraryStatus(): Promise<{ available: boolean; entries: number }> {
  const available = isLibraryAvailable();
  let entries = 0;
  if (available) {
    try { entries = (await getManifest()).length; } catch { /* ignore */ }
  }
  console.log(`[library] available=${available} cachedEntries=${entries}`);
  return { available, entries };
}

if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.__testLibraryMatch = testLibraryMatch;
  w.__libraryStatus = libraryStatus;
}
