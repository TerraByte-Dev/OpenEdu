import { describe, it, expect } from "vitest";
import {
  anchorAnnotations,
  finishReview,
  showsCorrectRemarks,
  unanchorable,
  validateReview,
  formatTranscript,
  appendSummary,
  buildReviewMessages,
  MAX_ANNOTATIONS,
  REVIEW_SCHEMA,
  type Annotation,
} from "./notebook-assistant";

const NOTE = "Photosynthesis happens in the mitochondria.\n\nATP is produced during the light reactions.";
const a = (quote: string, kind: Annotation["kind"] = "error", note = "x"): Annotation => ({ quote, kind, note });

describe("anchorAnnotations", () => {
  it("resolves a verbatim quote to its range", () => {
    const [hit] = anchorAnnotations(NOTE, [a("mitochondria")]);
    expect(NOTE.slice(hit.from, hit.to)).toBe("mitochondria");
  });

  it("drops a paraphrased quote rather than guessing", () => {
    expect(anchorAnnotations(NOTE, [a("the mitochondria organelle")])).toEqual([]);
  });

  it("drops a quote whose case does not match", () => {
    // Deliberate: case-insensitive anchoring would silently mark the wrong span in a note that uses
    // both "ATP" and "atp".
    expect(anchorAnnotations(NOTE, [a("MITOCHONDRIA")])).toEqual([]);
  });

  it("trims surrounding whitespace before anchoring", () => {
    expect(anchorAnnotations(NOTE, [a("  mitochondria  ")])).toHaveLength(1);
  });

  it("ignores an empty quote", () => {
    expect(anchorAnnotations(NOTE, [a("   ")])).toEqual([]);
  });

  it("returns annotations in document order", () => {
    const out = anchorAnnotations(NOTE, [a("ATP"), a("Photosynthesis")]);
    expect(out.map((x) => x.quote)).toEqual(["Photosynthesis", "ATP"]);
  });

  it("anchors a repeated quote to its first occurrence", () => {
    const doc = "alpha beta alpha";
    expect(anchorAnnotations(doc, [a("alpha")])[0].from).toBe(0);
  });

  it("dedupes the same quote and kind", () => {
    expect(anchorAnnotations(NOTE, [a("ATP"), a("ATP")])).toHaveLength(1);
  });

  it("keeps the same quote under two different kinds", () => {
    const out = anchorAnnotations(NOTE, [a("ATP", "error"), a("ATP", "question")]);
    expect(out).toHaveLength(2);
  });

  it("orders overlapping marks at one position by kind severity", () => {
    const out = anchorAnnotations(NOTE, [a("ATP", "correct"), a("ATP", "error")]);
    expect(out.map((x) => x.kind)).toEqual(["error", "correct"]);
  });
});

describe("unanchorable", () => {
  it("reports only the quotes that are missing", () => {
    const out = unanchorable(NOTE, [a("ATP"), a("chloroplast"), a("light reactions")]);
    expect(out.map((x) => x.quote)).toEqual(["chloroplast"]);
  });
});

describe("validateReview", () => {
  it("passes when every quote is verbatim", () => {
    expect(validateReview(NOTE)({ annotations: [a("ATP")] })).toEqual([]);
  });

  it("returns a repair message naming the bad quote", () => {
    const issues = validateReview(NOTE)({ annotations: [a("chloroplast")] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("chloroplast");
    expect(issues[0]).toContain("does not appear");
  });

  it("caps how many issues it reports so the repair prompt stays short", () => {
    const bad = ["p", "q", "r", "s", "t"].map((s) => a(`missing-${s}`));
    expect(validateReview(NOTE)(bad.length ? { annotations: bad } : { annotations: [] })).toHaveLength(3);
  });

  it("tolerates a response with no annotations array", () => {
    expect(validateReview(NOTE)({} as { annotations: Annotation[] })).toEqual([]);
  });
});

describe("formatTranscript", () => {
  const msg = (role: string, content: string) => ({ role, content });

  it("labels speakers and drops non-conversational roles", () => {
    const out = formatTranscript([msg("system", "ignore me"), msg("user", "hi"), msg("assistant", "hello")]);
    expect(out).toBe("Student: hi\n\nTutor: hello");
  });

  it("skips empty messages", () => {
    expect(formatTranscript([msg("user", "   "), msg("assistant", "ok")])).toBe("Tutor: ok");
  });

  it("keeps the END of a long conversation, not the start", () => {
    const many = Array.from({ length: 400 }, (_, i) => msg(i % 2 ? "assistant" : "user", `turn ${i} ${"pad ".repeat(20)}`));
    const out = formatTranscript(many, 200);
    expect(out).toContain("turn 399");
    expect(out).not.toContain("turn 0 ");
  });

  it("still returns something when a single message exceeds the budget", () => {
    const out = formatTranscript([msg("user", "word ".repeat(5000))], 50);
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns an empty string for an empty conversation", () => {
    expect(formatTranscript([])).toBe("");
  });
});

describe("appendSummary", () => {
  it("appends under a rule, preserving the existing note", () => {
    expect(appendSummary("# Mine\n\nnotes", "## Added")).toBe("# Mine\n\nnotes\n\n---\n\n## Added\n");
  });

  it("does not lead with a rule when the note is empty", () => {
    expect(appendSummary("", "## Added")).toBe("## Added\n");
    expect(appendSummary("   \n ", "## Added")).toBe("## Added\n");
  });

  it("collapses trailing whitespace rather than stacking blank lines", () => {
    expect(appendSummary("notes\n\n\n", "more")).toBe("notes\n\n---\n\nmore\n");
  });
});

describe("buildReviewMessages", () => {
  it("sends a system rule plus the note, and names an untitled note", () => {
    const [sys, user] = buildReviewMessages("", "body text");
    expect(sys.role).toBe("system");
    expect(sys.content).toContain("character-for-character");
    expect(user.content).toContain("Untitled");
    expect(user.content).toContain("body text");
  });

  it("caps a very long note instead of sending all of it", () => {
    const [, user] = buildReviewMessages("T", "word ".repeat(20000));
    expect(user.content.length).toBeLessThan(20000);
  });
});

describe("REVIEW_SCHEMA", () => {
  it("bounds the number of annotations", () => {
    expect(REVIEW_SCHEMA.properties.annotations.maxItems).toBe(MAX_ANNOTATIONS);
  });

  it("constrains kind to the four marks", () => {
    expect(REVIEW_SCHEMA.properties.annotations.items.properties.kind.enum)
      .toEqual(["error", "gap", "question", "correct"]);
  });
});

// The planted errors from the gemma4:e2b readiness run, which its review stamped "correct".
const PLANTED = [
  "Times tables: 6 x 7 = 48.",
  "Fractions: 1/3 is bigger than 1/2.",
  "In Python, range(3) gives 1, 2, 3.",
  "Spanish: Nosotros hablan.",
  "Coins: A nickel is worth 1 cent.",
  "Plants make food by photosynthesis.",
].join("\n");
const STAMPED: Annotation[] = [
  a("6 x 7 = 48", "correct", "Right, 6 times 7 is 48."),
  a("1/3 is bigger than 1/2", "correct", "Correct comparison."),
  a("range(3) gives 1, 2, 3", "correct", "Good."),
  a("Nosotros hablan", "correct", "Correct conjugation."),
  a("A nickel is worth 1 cent", "correct", "Yes."),
  a("photosynthesis", "gap", "Say where it happens."),
];

describe("finishReview", () => {
  it("on a tiny or small model shows no 'correct' remarks, and code marks the false arithmetic wrong", () => {
    for (const tier of ["tiny", "small", undefined] as const) {
      const { annotations } = finishReview(PLANTED, STAMPED, tier);
      expect(annotations.map((x) => [x.quote, x.kind, x.note])).toEqual([
        ["6 x 7 = 48", "error", "6 × 7 = 42, not 48."],
        ["1/3 is bigger than 1/2", "error", "1/3 is smaller than 1/2."],
        ["photosynthesis", "gap", "Say where it happens."],
      ]);
    }
  });

  it("on a larger model keeps 'correct' remarks, but never on a false arithmetic claim", () => {
    const { annotations } = finishReview(PLANTED, STAMPED, "large");
    const kinds = Object.fromEntries(annotations.map((x) => [x.quote, x.kind]));
    expect(kinds["6 x 7 = 48"]).toBe("error");
    expect(kinds["1/3 is bigger than 1/2"]).toBe("error");
    expect(kinds["Nosotros hablan"]).toBe("correct");
    expect(annotations.filter((x) => x.quote === "6 x 7 = 48")).toHaveLength(1);
  });

  it("marks a false claim the model said nothing about", () => {
    const { annotations } = finishReview("We learned 9 + 5 = 13 today.", [], "large");
    expect(annotations).toMatchObject([{ quote: "9 + 5 = 13", kind: "error", note: "9 + 5 = 14, not 13." }]);
  });

  it("keeps the model's own error mark on a false claim instead of adding a second", () => {
    const { annotations } = finishReview("We learned 9 + 5 = 13 today.", [a("= 13", "error", "It is 14.")], "small");
    expect(annotations).toMatchObject([{ quote: "= 13", kind: "error", note: "It is 14." }]);
  });

  it("drops an error mark on a true arithmetic claim", () => {
    const { annotations } = finishReview("We learned 6 x 7 = 42 today.", [a("6 x 7 = 42", "error", "It is 48.")], "large");
    expect(annotations).toEqual([]);
  });

  it("keeps a correct mark on a true claim on a larger model", () => {
    const { annotations } = finishReview("We learned 6 x 7 = 42 today.", [a("6 x 7 = 42", "correct", "Yes.")], "medium");
    expect(annotations).toMatchObject([{ kind: "correct" }]);
  });

  it("still counts the remarks it could not place", () => {
    expect(finishReview(NOTE, [a("not in the note"), a("mitochondria")], "small").dropped).toBe(1);
  });
});

describe("showsCorrectRemarks", () => {
  it("only on medium and large", () => {
    expect([showsCorrectRemarks("tiny"), showsCorrectRemarks("small"), showsCorrectRemarks(undefined),
      showsCorrectRemarks("medium"), showsCorrectRemarks("large")]).toEqual([false, false, false, true, true]);
  });
});
