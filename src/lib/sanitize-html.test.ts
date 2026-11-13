// @vitest-environment jsdom
// Security: everything the app inlines with dangerouslySetInnerHTML is untrusted (model output,
// cached lessons, library resources). These go through renderChatMarkdown, the function ChatTab,
// LessonReader and ResourcesTab call, and through the library SVG sanitizer the Resources tab uses.
import { beforeAll, describe, expect, it } from "vitest";
import { ensureChatKatex, renderChatMarkdown } from "./chat-markdown";
import { sanitizeSvg } from "./sanitize-html";
import flowchartSvg from "../../public/library/assets/arts-music-cs/flowchart-symbols.svg?raw";

// Parse the output the way the webview will, then look for anything that could run script.
function dangers(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const found: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (["script", "iframe", "object", "embed", "foreignobject"].includes(tag)) found.push(`<${tag}>`);
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) found.push(`${tag}[${attr.name}]`);
      if (/^\s*javascript:/i.test(attr.value)) found.push(`${tag}[${attr.name}=${attr.value}]`);
    }
  }
  return found;
}

beforeAll(async () => {
  await ensureChatKatex();
});

describe("renderChatMarkdown: untrusted HTML comes out inert", () => {
  it("strips an <img onerror> handler", () => {
    const html = renderChatMarkdown('Look: <img src=x onerror="alert(1)">');
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("onerror");
  });

  it("drops a <script> block and its body", () => {
    const html = renderChatMarkdown("Hi\n\n<script>alert(document.cookie)</script>\n\nthere");
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("alert(");
    expect(html).toContain("there");
  });

  it("neutralises javascript: links in markdown and raw HTML", () => {
    const html = renderChatMarkdown('[click](javascript:alert(1)) and <a href="javascript:alert(2)">me</a>');
    expect(dangers(html)).toEqual([]);
    expect(html).toContain("click");
  });

  it("drops an <iframe>", () => {
    const html = renderChatMarkdown('<iframe src="https://evil.example" srcdoc="<script>alert(1)</script>"></iframe>');
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
  });

  it("strips event handlers smuggled inside SVG and MathML", () => {
    const html = renderChatMarkdown('<svg><a href="javascript:alert(1)"><circle onload="alert(2)" r="5"/></a></svg><math><mi xlink:href="javascript:alert(3)">x</mi></math>');
    expect(dangers(html)).toEqual([]);
  });
});

describe("renderChatMarkdown: legitimate output survives sanitizing", () => {
  it("keeps KaTeX markup, inline styles, MathML and the TeX annotation", () => {
    const html = renderChatMarkdown("$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$");
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
    expect(html).toMatch(/<math[^>]*>/);
    expect(html).toContain("<semantics>");
    expect(html).toContain('<annotation encoding="application/x-tex">');
    expect(html).toMatch(/style="[^"]*height:/); // KaTeX's struts and vlists position with inline styles
    expect(html).toContain("<svg"); // \sqrt draws its radical as an SVG path
    expect(html).toMatch(/<path d="/);
    expect(dangers(html)).toEqual([]);
  });

  it("keeps a GFM table with alignment", () => {
    const html = renderChatMarkdown("| a | b |\n|:-:|--:|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain('<th align="center">a</th>');
    expect(html).toContain('<td align="right">2</td>');
  });

  it("keeps ordinary links, code, emphasis, lists and task boxes", () => {
    const html = renderChatMarkdown(
      "**bold** _it_ `code` [docs](https://example.com)\n\n- [x] done\n- [ ] todo\n\n```js\nlet a = 1 < 2;\n```",
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain('<code class="language-js">let a = 1 &lt; 2;');
  });
});

describe("sanitizeSvg (Resources tab card diagrams)", () => {
  it("strips script, foreignObject, handlers and javascript: hrefs", () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>' +
        '<foreignObject><iframe src="x"></iframe></foreignObject>' +
        '<a xlink:href="javascript:alert(3)" xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="5" height="5"/></a></svg>',
    );
    expect(dangers(svg)).toEqual([]);
    expect(svg).toContain("<rect");
  });

  it("keeps a real library card's shapes, text and <style>", () => {
    const raw = flowchartSvg;
    const svg = sanitizeSvg(raw);
    expect(svg).toContain("<style");
    const count = (s: string, tag: string) => (s.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
    for (const tag of ["text", "rect", "path"]) expect(count(svg, tag)).toBe(count(raw, tag));
  });
});
