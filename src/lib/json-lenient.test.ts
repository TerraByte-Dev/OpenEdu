import { describe, it, expect } from "vitest";
import { repairLatexControlChars, repairLatexInValue, sanitizeJsonEscapes, tryParseJsonLenient } from "./json-lenient";

// What the model wrote inside a JSON string, parsed the way every provider path parses it.
const parse = (jsonBody: string) => tryParseJsonLenient(`{"s":"${jsonBody}"}`) as { s: string };
const repaired = (jsonBody: string) => repairLatexControlChars(parse(jsonBody).s);

describe("repairLatexControlChars: mangled commands come back", () => {
  it.each([
    ["The circumference is 2\\text{πr}.", "The circumference is 2\\text{πr}."],
    ["3 \\times 4 = 12", "3 \\times 4 = 12"],
    ["$\\theta$ is an angle", "$\\theta$ is an angle"],
    ["Half is \\frac{1}{2}", "Half is \\frac{1}{2}"],
    ["\\frac12 of it", "\\frac12 of it"],
    ["\\begin{pmatrix}1\\end{pmatrix}", "\\begin{pmatrix}1\\end{pmatrix}"],
    ["$\\beta$ decay", "$\\beta$ decay"],
    ["\\left( x \\right)", "\\left( x \\right)"],
    ["$\\nabla f$", "$\\nabla f$"],
    ["x \\notin A", "x \\notin A"],
    ["\\textbf{Key idea}", "\\textbf{Key idea}"],
  ])("%s", (written, shown) => {
    expect(repaired(written)).toBe(shown);
  });

  it("repairs the short ones when the string is already doing LaTeX", () => {
    expect(repaired("$f = \\nu \\lambda$")).toBe("$f = \\nu \\lambda$");
    expect(repaired("$a \\neq b$")).toBe("$a \\neq b$");
    expect(repaired("$x \\to 0$")).toBe("$x \\to 0$");
    expect(repaired("$\\tan(x)$ and $\\rho$")).toBe("$\\tan(x)$ and $\\rho$");
  });

  it("leaves the backslash pairs and valid escapes it was given alone", () => {
    expect(repaired("\\\\alpha and \\\\text{x}")).toBe("\\alpha and \\text{x}");
    expect(repaired("caf\\u00e9")).toBe("café");
  });
});

describe("repairLatexControlChars: real tabs and newlines survive", () => {
  it.each([
    ["Step 1.\\nStep 2."],
    ["Name\\tAge\\nAda\\t9"],
    ["Line one\\nnew idea"],
    ["Fact:\\ntimes tables help"],          // \n + "times" is "ntimes": not a command
    ["Column\\ttext here"],                 // \t + "text" is "ttext": not a command
    ["Plan:\\nu is a vowel"],               // \nu, but no LaTeX anywhere and the line ends in ':'
    ["- one\\n- two\\n\\neq. means equation"],
    ["first\\tan apple"],                   // \tan, but no LaTeX in the string
    ["Price $5.\\nu-turn ahead"],           // a "$" but the newline follows sentence punctuation
    ["Windows line\\r\\nnext"],
    ["\\n\\nSection"],
  ])("%s", (written) => {
    const parsed = parse(written).s;
    expect(repairLatexControlChars(parsed)).toBe(parsed);
  });

  it("returns strings with no control characters untouched", () => {
    expect(repairLatexControlChars("plain")).toBe("plain");
  });
});

describe("repairLatexInValue", () => {
  it("repairs every string in nested objects and arrays, not keys or other types", () => {
    const value: unknown = JSON.parse('{"q":"2\\text{πr}","opts":["\\frac{1}{2}","plain"],"n":3,"ok":true,"nested":{"t\\tab":"\\times"},"none":null}');
    expect(repairLatexInValue(value)).toEqual({
      q: "2\\text{πr}",
      opts: ["\\frac{1}{2}", "plain"],
      n: 3,
      ok: true,
      nested: { "t\tab": "\\times" },
      none: null,
    });
  });
});

describe("sanitizeJsonEscapes", () => {
  it("doubles stray backslashes but not ones that are already doubled", () => {
    // A reply mixing a correctly escaped \\alpha with a bare \beta used to come back as \\alpha.
    expect(JSON.parse(sanitizeJsonEscapes('{"s":"\\\\alpha and \\gamma"}'))).toEqual({ s: "\\alpha and \\gamma" });
  });

  it("treats \\u without four hex digits as a stray backslash", () => {
    expect(tryParseJsonLenient('{"s":"\\underline{x} and \\u00e9"}')).toEqual({ s: "\\underline{x} and é" });
  });
});
