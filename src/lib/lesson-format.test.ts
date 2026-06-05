import { describe, it, expect } from "vitest";
import { assembleLessonMarkdown, type LessonContent } from "./lesson-format";

const full: LessonContent = {
  summary: "Variables name values so you can reuse them.",
  sections: [
    { heading: "What is a variable", body: "A box with a label." },
    { heading: "Assigning", body: "Use = to put a value in." },
  ],
  key_takeaways: ["Variables hold values", "Use = to assign"],
};

describe("assembleLessonMarkdown", () => {
  it("renders title, summary, sections, and takeaways as markdown", () => {
    const md = assembleLessonMarkdown("Variables", full);
    expect(md).toContain("# Variables");
    expect(md).toContain("Variables name values");
    expect(md).toContain("## What is a variable");
    expect(md).toContain("A box with a label.");
    expect(md).toContain("## Key takeaways");
    expect(md).toContain("- Variables hold values");
  });

  it("ends with a single trailing newline", () => {
    const md = assembleLessonMarkdown("X", full);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("skips empty sections and blank takeaways", () => {
    const md = assembleLessonMarkdown("Y", {
      summary: "S",
      sections: [{ heading: "", body: "" }, { heading: "Real", body: "Body" }],
      key_takeaways: ["keep", "   "],
    });
    expect(md).not.toContain("## \n");
    expect(md).toContain("## Real");
    expect(md).toContain("- keep");
    expect(md).not.toContain("-  \n");
  });

  it("omits the takeaways heading when there are none", () => {
    const md = assembleLessonMarkdown("Z", { summary: "S", sections: [{ heading: "H", body: "B" }], key_takeaways: [] });
    expect(md).not.toContain("Key takeaways");
  });
});
