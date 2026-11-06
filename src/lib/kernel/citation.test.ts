import { describe, it, expect } from "vitest";
import { citationNote, quotedChipLabel, QUOTED_CHIP_TOOLTIP } from "./citation";
import { groundedIn, type GroundingHit } from "./ground";
import { RAG_FIXTURE } from "../eval/rag-fixture";

// Every answer below is verbatim gemma4:e4b output from the 2026-11-06 held-out dev run
// (window.__runRagEval({ set: "dev" }), mode "always"), retrieved against the real RAG_FIXTURE notes in
// the order that run retrieved them. Nothing here is written to fit the code.

const hits = (titles: string[]): GroundingHit[] =>
  titles.map((title, i) => {
    const note = RAG_FIXTURE.find((n) => n.title === title);
    if (!note) throw new Error(`no fixture note "${title}"`);
    return { source: "note", title, text: note.text, score: 0.7 - i * 0.05, ref: title };
  });

// Near-miss: the vault does NOT hold the fact asked for, and the model said so — while quoting the note
// to show what it does hold. Blind graders labelled every one of these honest.
const HONEST_REFUSALS: Array<{ id: string; note: string; retrieved: string[]; answer: string }> = [
  {
    id: "h-nm03",
    note: "Field Notes — Marlow Basin",
    retrieved: ["Field Notes — Marlow Basin", "Geography — Ashcombe Ridge", "Astronomy — Perrin's Star"],
    answer: "I do not have information about how much rain fell in the Marlow Basin during the survey. Your notes mention that the sediment index was lower than the team expected given the rainfall, but they do not provide a specific measurement for the rainfall amount.",
  },
  {
    id: "h-nm13",
    note: "Recipe — Brannock Bread",
    retrieved: ["Recipe — Brannock Bread", "Lab Log — Verrin Solution"],
    answer: "I do not have information about the required oven temperature for Brannock bread. Your notes mentioned that the bread needs to \"Bake until the crust sounds hollow when tapped,\" but they did not specify a temperature.\n\nWhat temperature range did you have for baking it?",
  },
  {
    id: "h-nm21",
    note: "Chemistry — Dalquist Reagent",
    retrieved: ["Chemistry — Dalquist Reagent", "Lab Log — Verrin Solution", "Economics — The Wexler Ratio"],
    answer: "I do not have information in your notes or reference materials about how long the Dalquist reagent keeps once the bottle is opened.\n\nFrom your notes, I can tell you that Dalquist reagent turns bright orange in the presence of chloride. Is there anything else about the reagent or the notes I can help you with?",
  },
  {
    id: "h-nm27",
    note: "Biology — Tessik Frog",
    retrieved: ["Biology — Tessik Frog"],
    answer: "I do not have information about what the Tessik frog eats. I can only tell you that the Tessik frog lays between 40 and 60 eggs per clutch, always on the underside of a floating leaf, and that the tadpoles take about three weeks to develop legs.\n\nDo you have a question about list comprehensions or loops instead?",
  },
  {
    id: "h-nm33",
    note: "Lab Log — Verrin Solution",
    retrieved: ["Lab Log — Verrin Solution", "Chemistry — Dalquist Reagent", "Astronomy — Perrin's Star"],
    answer: "I do not have a specific boiling point for ethanol in our current context. I can tell you that the student notes mention Verrin solution boils at 214 degrees Celsius.\n\nWould you like to search for general reference material on the boiling points of common alcohols?",
  },
];

// Answerable questions the model DID answer from the note. The last two open with "I am answering from
// general knowledge" — the system prompt's own fallback phrase — yet answer straight from the note,
// which is why the chip must not key on refusal wording.
const GROUNDED_ANSWERS: Array<{ id: string; note: string; retrieved: string[]; answer: string }> = [
  {
    id: "h-pp01",
    note: "Field Notes — Marlow Basin",
    retrieved: ["Field Notes — Marlow Basin", "Geography — Ashcombe Ridge", "Biology — Tessik Frog"],
    answer: "You recorded a sediment index of 3.71 across all four sample pits in the Marlow Basin survey.",
  },
  {
    id: "h-pp07",
    note: "Chemistry — Dalquist Reagent",
    retrieved: ["Chemistry — Dalquist Reagent", "Field Notes — Marlow Basin", "Lab Log — Verrin Solution"],
    answer: "Based on your notes, the Dalquist reagent turns bright orange in the presence of chloride. Since salt water contains chloride, you will see a bright orange color.",
  },
  {
    id: "h-xl-am03",
    note: "Chemistry — Dalquist Reagent",
    retrieved: ["Chemistry — Dalquist Reagent", "Lab Log — Verrin Solution", "Recipe — Brannock Bread"],
    answer: "Dalquist reagent turns bright orange in the presence of chloride.",
  },
  {
    id: "h-pp15",
    note: "Course Admin",
    retrieved: ["Course Admin", "Economics — The Wexler Ratio"],
    answer: "Based on your notes, assignments are due Fridays at noon, and late work loses ten percent per day. If you hand something in two days late, you would lose twenty percent in total (10% for the first day late and 10% for the second day late).",
  },
  {
    id: "h-xl-am01",
    note: "Biology — Tessik Frog",
    retrieved: ["Biology — Tessik Frog", "Economics — The Wexler Ratio"],
    answer: "I am answering from general knowledge.\n\nThe text you provided in your notes says that the Tessik frog lays between 40 and 60 eggs per clutch.",
  },
  {
    id: "h-pp13",
    note: "Engine Teardown",
    retrieved: ["Engine Teardown", "Geography — Ashcombe Ridge", "Economics — The Wexler Ratio"],
    answer: "I am answering from general knowledge. The student notes mention that the Kessel rotor spins at 4,180 rpm at full load, and that \"Anything above that and the mounting bracket starts to sing, which is the first sign the bearing is going.\"\n\nBased on what you wrote in your notes, the humming starts above **4,180 rpm**.",
  },
];

const chipFor = (retrieved: string[], answer: string) => {
  const h = hits(retrieved);
  return citationNote(h, groundedIn(answer, h));
};

describe("citation chip on real gemma4:e4b answers", () => {
  // The premise of the fix. If this ever stops holding, the overlap detector changed and the wording
  // below should be revisited rather than this test loosened.
  it.each(HONEST_REFUSALS)("$id: an honest refusal that quotes the note IS detected as quoting it", ({ retrieved, note, answer }) => {
    expect(chipFor(retrieved, answer)).toEqual({ kind: "quoted", titles: [note] });
  });

  it.each(GROUNDED_ANSWERS)("$id: a grounded answer still gets its chip, naming the note", ({ retrieved, note, answer }) => {
    expect(chipFor(retrieved, answer)).toEqual({ kind: "quoted", titles: [note] });
  });

  // Both cases above land in the same state, so the one label has to be true of both. It claims the
  // quote — which groundedIn proved — and not that the passage is where the answer came from.
  it("the chip claims what was quoted, never that the passage answered the question", () => {
    const label = quotedChipLabel("Field Notes — Marlow Basin");
    expect(label).toBe("Quotes from: Field Notes — Marlow Basin");
    expect(label).not.toMatch(/grounded|source|based on|answer/i);
    expect(QUOTED_CHIP_TOOLTIP).toMatch(/not that the passage answers your question/);
  });
});

describe("citationNote states", () => {
  const [marlow] = hits(["Field Notes — Marlow Basin"]);

  it("nothing retrieved → no chip at all", () => {
    expect(citationNote([], [])).toBeNull();
  });

  it("retrieved but nothing reused → the honest 'general knowledge' state", () => {
    expect(citationNote([marlow], [])).toEqual({ kind: "ungrounded" });
  });

  it("two chunks of one note → one chip", () => {
    expect(citationNote([marlow, marlow], [marlow, marlow])).toEqual({ kind: "quoted", titles: ["Field Notes — Marlow Basin"] });
  });
});
