import { beforeAll, describe, expect, it } from "vitest";
import { ensureChatKatex, renderChatMarkdown } from "./chat-markdown";

// Issue #20: in one reply with several equations, only the first rendered and later ones leaked raw
// $…$ source. These tests go through renderChatMarkdown, the one function ChatTab calls for both the
// streaming bubble and persisted messages (and LessonReader / ResourcesTab).
//
// KaTeX emits exactly one class="katex" per formula (display math wraps it in class="katex-display",
// which does not match the bare token), so the count below is the number of typeset equations.
const countKatex = (html: string) => (html.match(/class="katex"/g) ?? []).length;
// KaTeX's MathML block holds the TeX source in an <annotation>; strip it before looking for leaked
// delimiters or LaTeX. What remains is prose plus KaTeX's visual (aria-hidden) glyph spans.
const prose = (html: string) => html.replace(/<span class="katex-mathml">[\s\S]*?<\/math><\/span>/g, "MATH");

beforeAll(async () => {
  await ensureChatKatex();
});

describe("renderChatMarkdown: several equations in one reply", () => {
  it("renders every $…$ span in a paragraph", () => {
    const html = renderChatMarkdown("First $a^2$, then $b^2$, so $c^2 = a^2 + b^2$.");
    expect(countKatex(html)).toBe(3);
    expect(prose(html)).not.toContain("$");
  });

  it("renders mixed inline and display math across paragraphs", () => {
    const text = [
      "The quadratic formula solves $ax^2 + bx + c = 0$:",
      "",
      "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$",
      "",
      "Here $a$ is the leading coefficient and $\\Delta = b^2 - 4ac$ is the discriminant.",
    ].join("\n");
    const html = renderChatMarkdown(text);
    expect(countKatex(html)).toBe(4);
    expect(prose(html)).not.toContain("$");
  });

  it("renders a multi-line $$ block written straight after a sentence (no blank line)", () => {
    const text = "The formula is:\n$$\nx = \\frac{-b}{2a}\n$$\nwhere $a \\neq 0$.";
    const html = renderChatMarkdown(text);
    expect(countKatex(html)).toBe(2);
    expect(html).toContain("katex-display");
    expect(prose(html)).not.toContain("$");
  });

  it("renders \\( \\) and \\[ \\] delimiters, several per reply", () => {
    const text = "Inline \\(E = mc^2\\) and \\(p = mv\\).\n\n\\[F = ma\\]\n\nAlso \\[\n a^2 + b^2 = c^2\n\\]";
    const html = renderChatMarkdown(text);
    expect(countKatex(html)).toBe(4);
    expect(prose(html)).not.toMatch(/\\[([]/);
  });

  it("does not let a currency $5 swallow the next equation", () => {
    const html = renderChatMarkdown("A ticket costs $5. The area is $x^2$ and the volume is $x^3$.");
    expect(countKatex(html)).toBe(2);
    expect(prose(html)).toContain("$5.");
    expect(prose(html)).not.toMatch(/\$x/);
  });

  it("keeps plain currency prose as text", () => {
    const html = renderChatMarkdown("Apples are $5 and pears are $10, so $15 in total.");
    expect(countKatex(html)).toBe(0);
    expect(html).toContain("$5 and pears are $10, so $15 in total.");
  });

  it("renders $ x $ with spaces inside the delimiters", () => {
    const html = renderChatMarkdown("Let $ x $ be the width and $ y = 2x $ the height.");
    expect(countKatex(html)).toBe(2);
    expect(prose(html)).not.toContain("$");
  });

  it("an unclosed $ does not break the equations after it", () => {
    const html = renderChatMarkdown("Let $x = 5 and then solve for the rest. Next $y = 2$ and $z = 3$.");
    expect(countKatex(html)).toBe(2);
    expect(prose(html)).toContain("$x = 5 and then");
  });

  it("renders LaTeX inside list items", () => {
    const text = "Steps:\n\n1. Subtract: $2x = 6$\n2. Divide: $x = \\frac{6}{2} = 3$\n- Check: $2(3) = 6$";
    const html = renderChatMarkdown(text);
    expect(countKatex(html)).toBe(3);
    expect(prose(html)).not.toContain("$");
  });

  it("renders a bare \\frac written without delimiters", () => {
    const html = renderChatMarkdown("Half is \\frac{1}{2} and a third is \\frac{1}{3}.");
    expect(countKatex(html)).toBe(2);
    expect(prose(html)).not.toContain("\\frac");
  });

  it("renders bare \\times and \\sqrt but leaves unknown commands alone", () => {
    const html = renderChatMarkdown("So 3 \\times 4 = 12 and \\sqrt{16} = 4, but \\left( stays.");
    expect(countKatex(html)).toBe(2);
    expect(prose(html)).toContain("\\left( stays.");
  });

  it("accepts a stray space before the closer when nothing follows it", () => {
    expect(countKatex(renderChatMarkdown("So $x = 5 $ and done."))).toBe(1);
  });

  it("renders $$…$$ in the middle of a line", () => {
    const html = renderChatMarkdown("We get $$x = 2$$ as the answer and $y = 3$.");
    expect(countKatex(html)).toBe(2);
    expect(html).toContain("katex-display");
  });

  it("every streaming prefix renders without throwing, and the full reply renders all math", () => {
    const reply = "The formula is:\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\nwhere $a \\neq 0$, it costs $5, and \\(y\\) and \\[z\\]";
    for (let i = 1; i < reply.length; i++) expect(() => renderChatMarkdown(reply.slice(0, i))).not.toThrow();
    expect(countKatex(renderChatMarkdown(reply))).toBe(4);
  });

  it("one malformed equation falls back on its own and later ones still render", () => {
    const html = renderChatMarkdown("Bad $\\frac{1}{$ then good $a+b$ and $c^2$.");
    expect(countKatex(html)).toBeGreaterThanOrEqual(2);
    expect(prose(html)).not.toMatch(/\$a\+b\$|\$c\^2\$/);
  });

  it("renders mhchem \\ce{} reactions", () => {
    expect(countKatex(renderChatMarkdown("Water: $\\ce{2H2 + O2 -> 2H2O}$"))).toBe(1);
  });

  it("renders paren-adjacent spans (issue #23)", () => {
    expect(countKatex(renderChatMarkdown("($s$ vs. $t$)"))).toBe(2);
    expect(countKatex(renderChatMarkdown("water $\\text{H}_2\\text{O}$)"))).toBe(1);
  });
});

describe("renderChatMarkdown: code is left alone", () => {
  it("does not render math inside inline code", () => {
    const html = renderChatMarkdown("Type `$x^2$` or `\\(y\\)` or `\\frac{1}{2}` in the box, then $z$.");
    expect(countKatex(html)).toBe(1);
    expect(html).toContain("<code>$x^2$</code>");
    expect(html).toContain("<code>\\(y\\)</code>");
    expect(html).toContain("<code>\\frac{1}{2}</code>");
  });

  it("does not render math inside fenced code blocks", () => {
    const text = "```python\nprice = \"$5\"\nprint(\"\\(x\\) costs $\" + price + \"$\")\nr\"\\frac{1}{2}\"\n```\nThen $a$.";
    const html = renderChatMarkdown(text);
    expect(countKatex(html)).toBe(1);
    expect(html).toContain("\\(x\\) costs $");
    expect(html).toContain("\\frac{1}{2}");
  });

  it("leaves an escaped \\$ as a literal dollar", () => {
    const html = renderChatMarkdown("It costs \\$5 and \\$10.");
    expect(countKatex(html)).toBe(0);
    expect(html).toContain("$5 and $10.");
  });
});
