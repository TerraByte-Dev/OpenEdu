import { describe, it, expect } from "vitest";
import {
  contentWords,
  shouldRetrieve,
  selectHits,
  formatGroundingBlock,
  groundedIn,
  MIN_NOTE_SCORE,
  type GroundingHit,
} from "./ground";
import { budgetFor, estTokens } from "./budget";

const hit = (over: Partial<GroundingHit> = {}): GroundingHit => ({
  source: "note",
  title: "Cells",
  text: "The mitochondria is the powerhouse of the cell and produces ATP through respiration.",
  score: 0.8,
  ref: "doc-1",
  ...over,
});

describe("contentWords", () => {
  it("strips stopwords and punctuation", () => {
    expect(contentWords("What is the mitochondria?")).toEqual(["mitochondria"]);
    expect(contentWords("thanks!")).toEqual([]);
  });
});

describe("shouldRetrieve", () => {
  it("skips conversational turns that would inject unrelated context into small talk", () => {
    expect(shouldRetrieve("thanks!", "always").retrieve).toBe(false);
    expect(shouldRetrieve("ok got it", "always").reason).toBe("short-query");
  });

  it("retrieves for a real question", () => {
    expect(shouldRetrieve("how does cellular respiration produce ATP in mitochondria", "always").retrieve).toBe(true);
  });

  // Regression: the gate required 4 content words and rejected this, which was the ONLY positive
  // failure in the first clean eval run. A short question about a named thing is the normal shape of
  // a student question — the score floor, not the word count, is what keeps irrelevant hits out.
  it("retrieves for a short question about a named thing", () => {
    for (const q of [
      "How high is Ashcombe Ridge?",
      "Who wrote Hamlet?",
      "What is photosynthesis?",
      "define entropy",
    ]) {
      expect(shouldRetrieve(q, "always").retrieve, q).toBe(true);
    }
  });

  it("honours the off switch regardless of the question", () => {
    const r = shouldRetrieve("how does cellular respiration produce ATP in mitochondria", "off");
    expect(r.retrieve).toBe(false);
    expect(r.reason).toBe("disabled");
  });
});

describe("selectHits", () => {
  it("drops everything under the score floor", () => {
    const out = selectHits([hit({ score: 0.9 }), hit({ score: 0.2, ref: "doc-2" })]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.9);
  });

  it("returns nothing when the whole vault is off-topic", () => {
    // The failure this prevents: a biology vault answering "what is a for loop?" with five biology
    // chunks wearing a citation chip.
    const out = selectHits([hit({ score: 0.3 }), hit({ score: 0.25, ref: "doc-2" }), hit({ score: 0.1, ref: "doc-3" })]);
    expect(out).toEqual([]);
  });

  it("caps how many chunks one document can contribute", () => {
    const same = [0.9, 0.88, 0.86, 0.84].map((score) => hit({ score, ref: "doc-1" }));
    const other = hit({ score: 0.5, ref: "doc-2", title: "Other" });
    const out = selectHits([...same, other]);
    expect(out.filter((h) => h.ref === "doc-1")).toHaveLength(2);
    expect(out.some((h) => h.ref === "doc-2")).toBe(true);
  });

  it("caps total hits", () => {
    const many = Array.from({ length: 10 }, (_, i) => hit({ score: 0.9 - i * 0.01, ref: `doc-${i}` }));
    expect(selectHits(many)).toHaveLength(3);
  });

  it("returns hits strongest-first", () => {
    const out = selectHits([hit({ score: 0.6, ref: "a" }), hit({ score: 0.95, ref: "b" }), hit({ score: 0.75, ref: "c" })]);
    expect(out.map((h) => h.score)).toEqual([0.95, 0.75, 0.6]);
  });

  it("treats the floor as inclusive", () => {
    expect(selectHits([hit({ score: MIN_NOTE_SCORE })])).toHaveLength(1);
  });

  // A library card is pinned just above the floor while notes reach 0.9, so on pure rank the
  // verified material loses every time there are three decent notes. It is the one passage the model
  // is allowed to trust; it gets a seat.
  it("reserves a slot for verified reference material", () => {
    const strongNotes = [0.95, 0.9, 0.85].map((score, i) => hit({ score, ref: `doc-${i}` }));
    const reference = hit({ source: "library", score: 0.5, ref: "lib:x", title: "Periodic Table" });
    const out = selectHits([...strongNotes, reference]);
    expect(out).toHaveLength(3);
    expect(out.some((h) => h.source === "library")).toBe(true);
    // ...by displacing the WEAKEST note, not the strongest.
    expect(out.map((h) => h.score)).toContain(0.95);
    expect(out.map((h) => h.score)).toContain(0.9);
    expect(out.map((h) => h.score)).not.toContain(0.85);
  });

  it("does not manufacture a reference slot when no card qualifies", () => {
    const notes = [0.95, 0.9, 0.85].map((score, i) => hit({ score, ref: `doc-${i}` }));
    expect(selectHits(notes)).toHaveLength(3);
    expect(selectHits(notes).every((h) => h.source === "note")).toBe(true);
  });

  it("leaves a reference that already made the cut alone", () => {
    const out = selectHits([
      hit({ score: 0.95, ref: "doc-0" }),
      hit({ source: "library", score: 0.5, ref: "lib:x" }),
    ]);
    expect(out.filter((h) => h.source === "library")).toHaveLength(1);
  });
});

// The distinction that broke the first clean eval run: "nothing survived the floor" and "the corpus
// is empty" look identical if you only count surviving hits, and they mean opposite things. A
// negative question SHOULD retrieve candidates and reject all of them.
describe("floor rejection vs empty corpus", () => {
  it("rejecting every candidate is not the same as having none", () => {
    const offTopic = [hit({ score: 0.39, ref: "a" }), hit({ score: 0.31, ref: "b" }), hit({ score: 0.2, ref: "c" })];
    expect(selectHits(offTopic)).toEqual([]);   // correctly grounded in nothing
    expect(offTopic.length).toBe(3);            // but the vault plainly had material to reject
  });
});

describe("formatGroundingBlock", () => {
  it("is empty when there is nothing to say", () => {
    expect(formatGroundingBlock([], 1000)).toBe("");
  });

  it("emits plain labelled text with no JSON, ids, or scores", () => {
    const out = formatGroundingBlock([hit()], 1000);
    expect(out).toContain("<context>");
    expect(out).toContain("[STUDENT NOTE: Cells]");
    expect(out).toContain("powerhouse");
    // The tool path leaked UUIDs and floats into the window; this must not.
    expect(out).not.toContain("doc-1");
    expect(out).not.toContain("0.8");
    expect(out).not.toContain("{");
  });

  it("carries the grounding instruction next to the evidence", () => {
    const out = formatGroundingBlock([hit()], 1000);
    expect(out).toMatch(/name the title you drew on/i);
    expect(out).toMatch(/general knowledge/i);
  });

  it("labels reference and student material distinctly", () => {
    const both = formatGroundingBlock(
      [hit({ source: "library", title: "Periodic Table", ref: "lib:pt" }), hit()],
      2000,
    );
    expect(both).toContain("[REFERENCE: Periodic Table]");
    expect(both).toContain("[STUDENT NOTE: Cells]");
  });

  // The distinction that matters: a reference is true, a note is only what the student believes.
  // Without this the tutor repeats a student's own misconception back with a citation attached,
  // which makes the mistake look verified.
  it("tells the model how much to trust each corpus", () => {
    const both = formatGroundingBlock(
      [hit({ source: "library", title: "Periodic Table", ref: "lib:pt" }), hit()],
      2000,
    );
    expect(both).toMatch(/REFERENCE passages are verified/i);
    expect(both).toMatch(/may be incomplete or mistaken/i);
    expect(both).toMatch(/gently correct it/i);
  });

  it("only describes the corpora actually present", () => {
    const notesOnly = formatGroundingBlock([hit()], 1000);
    expect(notesOnly).toMatch(/STUDENT NOTE passages/i);
    expect(notesOnly).not.toMatch(/REFERENCE passages are verified/i);

    const refOnly = formatGroundingBlock([hit({ source: "library", ref: "lib:x" })], 1000);
    expect(refOnly).toMatch(/REFERENCE passages are verified/i);
    expect(refOnly).not.toMatch(/STUDENT NOTE passages/i);
  });

  it("never exceeds the grounding budget", () => {
    const fat = Array.from({ length: 5 }, (_, i) => hit({ ref: `d${i}`, text: "word ".repeat(4000) }));
    for (const total of [2048, 4096, 8192]) {
      const b = budgetFor(total);
      const out = formatGroundingBlock(fat, b.grounding);
      expect(estTokens(out)).toBeLessThanOrEqual(b.grounding);
    }
  });

  it("drops later passages rather than emitting a half one", () => {
    const b = budgetFor(2048);
    const out = formatGroundingBlock([hit({ ref: "a" }), hit({ ref: "b", text: "x ".repeat(5000) })], b.grounding);
    expect(out).toContain("<context>");
    expect(out.trimEnd().endsWith("</context>")).toBe(true);
  });
});

describe("groundedIn — the honesty mechanism", () => {
  const source = hit({
    text: "Photosynthesis converts carbon dioxide and water into glucose using energy absorbed from sunlight.",
  });

  it("detects an answer that reuses the retrieved passage", () => {
    const answer = "Plants do this because photosynthesis converts carbon dioxide and water into glucose using energy from sunlight.";
    expect(groundedIn(answer, [source])).toHaveLength(1);
  });

  it("reports NOT grounded when the answer came from general knowledge", () => {
    const answer = "Plants are green organisms that grow in soil and need regular watering to survive.";
    expect(groundedIn(answer, [source])).toEqual([]);
  });

  // The fabricated-citation case: the model SAYS it used the notes but reused none of their language.
  // This is exactly what the falsification condition tests, and why the chip cannot be model-asserted.
  it("is not fooled by an answer that merely claims to have used the notes", () => {
    const answer = "According to your notes, the process is complicated and depends on several factors.";
    expect(groundedIn(answer, [source])).toEqual([]);
  });

  it("ignores stopword padding — matching is on content words", () => {
    const answer = "So, the photosynthesis converts carbon dioxide and water into glucose using the energy of sunlight, you see.";
    expect(groundedIn(answer, [source])).toHaveLength(1);
  });

  it("returns only the hits actually used", () => {
    const other = hit({ ref: "doc-9", title: "Rocks", text: "Igneous rock forms when molten magma cools and solidifies underground." });
    const answer = "Photosynthesis converts carbon dioxide and water into glucose using energy absorbed from sunlight.";
    const used = groundedIn(answer, [source, other]);
    expect(used).toHaveLength(1);
    expect(used[0].title).toBe("Cells");
  });

  it("handles short answers and empty hit lists without throwing", () => {
    expect(groundedIn("Yes.", [source])).toEqual([]);
    expect(groundedIn("a long enough answer with plenty of content words here", [])).toEqual([]);
  });

  it("gets stricter as n grows", () => {
    const answer = "Photosynthesis converts carbon dioxide and water into something else entirely.";
    expect(groundedIn(answer, [source], 4).length).toBe(1);
    expect(groundedIn(answer, [source], 12).length).toBe(0);
  });
});
