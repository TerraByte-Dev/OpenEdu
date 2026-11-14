import { describe, it, expect } from "vitest";
import { speakableText, texWords, pickVoice, CODE_SPOKEN, DRAWING_SPOKEN, MATH_PLACEHOLDER, type VoiceLike } from "./speech";
import { persistedReply } from "./kernel/persistedReply";

// speakableText is what ChatTab's speaker button and the K-2 auto-read hand to speechSynthesis
// (useReadAloud.ts), on the reply exactly as saved. Nothing a voice would read as a symbol may survive.
const NO_SYNTAX = /[\\$*_`#{}[\]|~]/;

describe("speakableText: markdown", () => {
  it("drops emphasis, headings and links, keeping the words", () => {
    const text = speakableText("## Adding fractions\nThis is **really** _important_. See [the notes](https://example.com).");
    expect(text).toBe("Adding fractions. This is really important. See the notes.");
  });

  it("reads each list item as its own sentence", () => {
    expect(speakableText("Steps:\n\n1. Find a common denominator\n2. Add the tops\n\n- done")).toBe(
      "Steps: Find a common denominator. Add the tops. done.",
    );
  });

  it("pauses at a line break inside a paragraph", () => {
    expect(speakableText("Step 1: add\nStep 2: carry")).toBe("Step 1: add. Step 2: carry.");
  });

  it("reads a code block as one word and inline code as its text", () => {
    const text = speakableText("Run this:\n\n```python\nprint('hi')\nx = {1: 2}\n```\n\nThen call `print` again.");
    expect(text).toBe(`Run this: ${CODE_SPOKEN}. Then call print again.`);
  });

  it("reads a ```mermaid fence as a drawing, since the chat draws it (gemma4:e2b reply d01, B9 run)", () => {
    const reply = "Here is the flowchart showing how an if/else statement works:\n\n```mermaid\ngraph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n```\n\nThis flowchart shows the steps of an if/else statement.";
    expect(speakableText(reply)).toBe(`Here is the flowchart showing how an if/else statement works: ${DRAWING_SPOKEN}. This flowchart shows the steps of an if/else statement.`);
  });

  it("reads Mermaid written with no fence as a drawing too, not its source", () => {
    const reply = "Here is the plan:\n\nmermaid\ngraph TD;\n    A[Wake up] --> B[Eat breakfast];\n\nThen we go to school.";
    expect(speakableText(reply)).toBe(`Here is the plan: ${DRAWING_SPOKEN}. Then we go to school.`);
  });

  it("reads quotes and tables as plain sentences", () => {
    expect(speakableText("> Remember this.")).toBe("Remember this.");
    expect(speakableText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a, b. 1, 2.");
  });

  it("drops emoji, html and rules", () => {
    expect(speakableText("Great job! 🎉🧩\n\n---\n\n<b>Next</b> one")).toBe("Great job! Next one.");
  });

  it("reads an interrupted reply's marker as words", () => {
    const saved = persistedReply("Fractions have two parts", "stalled")!;
    const text = speakableText(saved);
    expect(text).toMatch(/^Fractions have two parts\. the tutor stopped responding/);
    expect(text).not.toMatch(NO_SYNTAX);
  });

  it("leaves a price as a price", () => {
    expect(speakableText("It costs $5 and that one $10.")).toBe("It costs $5 and that one $10.");
  });

  it("is empty when there is nothing to say", () => {
    expect(speakableText("")).toBe("");
    expect(speakableText("---\n\n🎉")).toBe("");
  });
});

describe("speakableText: math", () => {
  it("reads inline and display math as words, never raw LaTeX", () => {
    const reply = [
      "The area is $A = \\pi r^2$, and the quadratic formula is:",
      "",
      "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$",
      "",
      "Also \\(3 \\times 4 = 12\\) and \\[\\frac{1}{2}\\].",
    ].join("\n");
    const text = speakableText(reply);
    expect(text).not.toMatch(NO_SYNTAX);
    expect(text).toContain("A equals pi r squared");
    expect(text).toContain("x equals minus b plus or minus the square root of b squared minus 4ac over 2a");
    expect(text).toContain("3 times 4 equals 12");
    expect(text).toContain("1 over 2");
  });

  it("reads bare LaTeX the tutor forgot to fence", () => {
    expect(speakableText("So the answer is \\frac{3}{4} of the pizza.")).toBe("So the answer is 3 over 4 of the pizza.");
  });

  it("never lets a backslash through, whatever the reply holds", () => {
    for (const reply of [
      "A stray \\ backslash and \\unknown command",
      "$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$",
      "$\\weird{x}$ and $\\text{speed} = \\dfrac{d}{t}$",
    ]) {
      expect(speakableText(reply), reply).not.toMatch(/\\/);
    }
  });
});

describe("texWords", () => {
  it("reads common school math", () => {
    expect(texWords("x^2 + y^3")).toBe("x squared plus y cubed");
    expect(texWords("2^{10}")).toBe("2 to the power of 10");
    expect(texWords("\\sqrt[3]{27} = 3")).toBe("the cube root of 27 equals 3");
    expect(texWords("a_1 \\leq b")).toBe("a sub 1 is less than or equal to b");
    expect(texWords("90^\\circ")).toBe("90 degrees");
    expect(texWords("\\text{distance} = \\text{rate} \\cdot t")).toBe("distance equals rate times t");
    expect(texWords("\\theta \\neq \\Delta x")).toBe("theta is not equal to delta x");
    expect(texWords("50\\%")).toBe("50 percent");
    expect(texWords("\\left( \\frac{1}{2} \\right)")).toBe("1 over 2");
    expect(texWords("\\ce{2H2 + O2 -> 2H2O}")).toBe("2H2 plus O2 gives 2H2O");
  });

  it("reads a matrix or aligned block as a placeholder", () => {
    expect(texWords("\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}")).toBe(MATH_PLACEHOLDER);
  });

  it("reads an unknown command as its name", () => {
    expect(texWords("\\sinh x")).toBe("sinh x");
  });
});

describe("pickVoice", () => {
  const v = (lang: string, localService: boolean, def = false, name = lang): VoiceLike & { name: string } => ({ lang, localService, default: def, name });

  it("picks an on-device voice in the UI language over an online one", () => {
    const voices = [v("en-US", false, true, "online"), v("en-US", true, false, "David"), v("en-GB", true, false, "Hazel")];
    expect(pickVoice(voices, "en-US")?.name).toBe("David");
  });

  it("falls back from the exact language to the same language, then to English", () => {
    expect(pickVoice([v("fr-FR", true), v("en-GB", true, false, "Hazel")], "en-US")?.name).toBe("Hazel");
    expect(pickVoice([v("fr-FR", true), v("en-US", true, false, "Zira")], "es-MX")?.name).toBe("Zira");
    expect(pickVoice([v("es-ES", true, false, "Helena"), v("en-US", true)], "es-MX")?.name).toBe("Helena");
  });

  it("prefers the system default within a rank", () => {
    expect(pickVoice([v("en-US", true, false, "David"), v("en-US", true, true, "Zira")], "en-US")?.name).toBe("Zira");
  });

  it("returns null when there is no on-device voice it can use", () => {
    expect(pickVoice([], "en-US")).toBeNull();
    expect(pickVoice([v("en-US", false)], "en-US")).toBeNull();
    expect(pickVoice([v("fr-FR", true)], "en-US")).toBeNull();
  });

  it("accepts underscores and odd case in language tags", () => {
    expect(pickVoice([v("EN_us", true, false, "x")], "en-US")?.name).toBe("x");
  });
});
