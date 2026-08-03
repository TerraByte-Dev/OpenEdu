import { describe, it, expect } from "vitest";
import {
  anchorAnnotations,
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
