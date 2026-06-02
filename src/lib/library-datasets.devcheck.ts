// Dev-only self-test for the LOOKUP layer — registered only in `tauri dev` (see main.tsx). The
// `library.lookup` tool is eval-SUPPRESSED in the golden runner (apples-to-apples baseline), so its
// correctness can't be proven there. This harness proves it deterministically instead — no model, no
// network beyond the bundled datasets — by exercising every dataset + computed engine and checking the
// answer. Model tool-ROUTING (does the 4B model pick lookup vs search?) is verified manually in-app.
//
//   __testLibraryLookup()   // run all cases; logs ✓/✗ and an N/total summary
//   __datasetStatus()       // is the dataset manifest cached? how many datasets?

import { lookup, areDatasetsAvailable, refreshDatasetManifest } from "./library-datasets";

const CASES: Array<{ ds: string; q: string; want: string }> = [
  { ds: "number_base", q: "convert 255 to hexadecimal", want: "FF" },
  { ds: "number_base", q: "0b1011 to decimal", want: "11" },
  { ds: "number_base", q: "what is 16 in binary", want: "10000" },
  { ds: "ascii_table", q: "ASCII code for the letter A", want: "65" },
  { ds: "ascii_table", q: "what character is ASCII 97", want: "'a'" },
  { ds: "us_presidents", q: "who was the 16th president", want: "Lincoln" },
  { ds: "us_presidents", q: "Theodore Roosevelt", want: "26" },
  { ds: "us_states", q: "capital of California", want: "Sacramento" },
  { ds: "us_states", q: "what is the postal abbreviation for Texas", want: "TX" },
  { ds: "country_profiles", q: "capital of Japan", want: "Tokyo" },
  { ds: "country_profiles", q: "what currency does Brazil use", want: "Real" },
  { ds: "currencies", q: "JPY", want: "yen" },
  { ds: "scotus_cases", q: "Miranda v Arizona", want: "interrogation" },
  { ds: "nomenclature", q: "formula for sodium chloride", want: "NaCl" },
  { ds: "vocabulary", q: "how do you say dog in Spanish", want: "perro" },
  { ds: "vocabulary", q: "hello in French", want: "bonjour" },
  { ds: "verb_conjugation", q: "conjugate comer", want: "como" },
  { ds: "verb_conjugation", q: "present tense of être", want: "suis" },
  { ds: "verb_conjugation", q: "conjugate the verb cantar", want: "canto" }, // regular -ar fallback
  { ds: "rulers_dynasties", q: "Genghis Khan", want: "Mongol" },
  { ds: "wars_treaties", q: "Treaty of Versailles", want: "Germany" },
];

async function testLibraryLookup(): Promise<number> {
  let pass = 0;
  for (const c of CASES) {
    try {
      const r = await lookup(c.ds, c.q);
      const hay = `${r.title} ${r.text}`.toLowerCase();
      const ok = r.found && hay.includes(c.want.toLowerCase());
      console.log(ok ? "✓" : "✗", c.ds.padEnd(16), JSON.stringify(c.q), ok ? "" : `→ ${r.found ? `got "${r.text}"` : "(not found)"} — wanted "${c.want}"`);
      if (ok) pass++;
    } catch (e) {
      console.log("✗", c.ds, JSON.stringify(c.q), "ERROR", e);
    }
  }
  console.log(`__testLibraryLookup: ${pass}/${CASES.length} passed`);
  return pass;
}

async function datasetStatus(): Promise<{ available: boolean }> {
  if (!areDatasetsAvailable()) await refreshDatasetManifest();
  const available = areDatasetsAvailable();
  console.log(`[library.lookup] datasetsAvailable=${available}`);
  return { available };
}

if (typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  w.__testLibraryLookup = testLibraryLookup;
  w.__datasetStatus = datasetStatus;
}
