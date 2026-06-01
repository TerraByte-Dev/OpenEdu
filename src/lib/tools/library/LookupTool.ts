// library.lookup — look up ONE precise record (or compute ONE exact value) from a structured reference
// dataset that is too big for a card: a specific president, country, currency, Supreme Court case,
// chemical formula, a base conversion, or a verb conjugation. Read-only; wraps the deterministic
// datasets + computed engines in ../../library-datasets. Sits beside library.search — see the sharply
// contrasted descriptions (CARD/TOPIC vs RECORD/VALUE) so the floor model routes correctly. Hidden
// unless the library is enabled AND the dataset manifest is cached (offline-first).

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { lookup, areDatasetsAvailable } from "../../library-datasets";
import { isLibraryAvailable } from "../../library";
import { getLibraryEnabled } from "../../store";
import type { LibraryLookupResult } from "../../../types";

export const libraryLookupTool = defineTool({
  name: "library.lookup",
  description:
    "Look up ONE specific record, or compute ONE exact value, from a structured reference DATASET — a " +
    "named entity or a value, NOT a whole topic. Pick the matching `dataset`: us_presidents, " +
    "scotus_cases, us_states, country_profiles, currencies, rulers_dynasties, wars_treaties, " +
    "nomenclature (chemical name↔formula), vocabulary (Spanish/French words), verb_conjugation " +
    "(Spanish/French), ascii_table, number_base (binary/decimal/hex/octal). Use this for a single " +
    "fact, code, or conversion (e.g. 'the 16th president', 'capital of Japan', 'formula for sodium " +
    "chloride', '255 to hex'). For a whole reference SHEET on a topic, use library.search instead.",
  inputSchema: z.object({
    dataset: z
      .enum([
        "us_presidents", "scotus_cases", "us_states", "country_profiles", "currencies",
        "rulers_dynasties", "wars_treaties", "nomenclature", "vocabulary", "verb_conjugation",
        "ascii_table", "number_base",
      ])
      .describe("Which exact dataset to consult — pick the one that matches the question."),
    query: z
      .string()
      .min(1)
      .describe("The lookup key in natural language — a name, code, value, or term (e.g. 'Abraham Lincoln', 'Japan', 'JPY', '255 to hex', 'comer', 'sodium chloride')."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  // found ⇒ a non-empty grounded answer with a citation — caught as a repairable error otherwise.
  validateOutput: (out: LibraryLookupResult) =>
    out.found && (!out.text.trim() || !out.source.trim()) ? ["a found result must carry non-empty text and source"] : [],
  isEnabled: async () => (await getLibraryEnabled()) && isLibraryAvailable() && areDatasetsAvailable(),
  async *call(input, _ctx): AsyncGenerator<ToolEvent<LibraryLookupResult>> {
    yield { kind: "progress", message: `looking up "${input.query}" in ${input.dataset}…` };
    const result = await lookup(input.dataset, input.query);
    yield { kind: "result", value: result };
  },
});
