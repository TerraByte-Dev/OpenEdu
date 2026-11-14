// @vitest-environment jsdom
// (Mermaid's parser needs a DOM.)
import { describe, it, expect, beforeAll } from "vitest";
import mermaid from "mermaid";
import { splitReplyDiagrams, drawableMermaid, diagramFallback, withoutRemoteLoads, type MermaidParse } from "./mermaid-source";

// What ChatTab and MermaidBlock draw for a diagram in a reply. The diagrams are gemma4:e2b's own, from
// the B9 readiness run (2026-11-13): d01 wrote its flowchart as a ```mermaid fence instead of calling
// diagram.render, and d04, d18 and d20 called diagram.render with source mermaid.parse rejects, so the
// child saw the raw source. The parser is the real one, called the way MermaidBlock calls it.

const D01 = "I can draw a flowchart for an if/else statement. This will show the steps of that control flow.\n\nHere is the flowchart showing how an if/else statement works:\n\n```mermaid\ngraph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n    B -- No --> D[Execute the 'else' block];\n    C --> E[End];\n    D --> E;\n```\n\nThis flowchart shows the steps of an if/else statement. It starts, checks a condition, and then follows one path based on whether the condition is true or false.\n\nDo you want to try writing a small Python program that uses an if statement next?";
const D01_CODE = "graph TD;\n    A[Start] --> B{Condition?};\n    B -- Yes --> C[Execute the 'if' block];\n    B -- No --> D[Execute the 'else' block];\n    C --> E[End];\n    D --> E;";
const D04 = "graph TD;\n    A[Start] --> B{Input a number N};\n    B --> C{Is N divisible by 2?};\n    C -- Yes --> D[Print \"N is Even\"];\n    C -- No --> E[Print \"N is Odd\"];\n    D --> F[End];\n    E --> F;\n";
const D18 = "graph TD;\n    A[Point 1: (x1, y1)] -- \"Run (x2 - x1)\" --> B[Point 2: (x2, y2)];\n    A -- \"Rise (y2 - y1)\" --> C[Change in y];\n    style A fill:#f9f,stroke:#333,stroke-width:2px\n    style B fill:#f9f,stroke:#333,stroke-width:2px\n    style C fill:#ccf,stroke:#333,stroke-width:2px\n    subgraph Slope Calculation\n        C --> D{Slope (m) = Rise / Run};\n    end";
const D20 = "graph TD;\n    A[Start: Have a shape problem] --> B{Is the problem about the outside boundary?};\n    B -- Yes --> C[Calculate Perimeter];\n    B -- No --> D{Is the problem about the flat surface?};\n    D -- Yes --> E[Calculate Area];\n    D -- No --> F{Is the problem about the space inside (3D shape)?};\n    F -- Yes --> G[Calculate Volume];\n    F -- No --> H[Check the problem type again];\n    C --> I[End];\n    E --> I;\n    G --> I;\n    H --> B;\n";

// MermaidBlock's parse: mermaid.parse with suppressErrors, false when Mermaid cannot draw it.
const parse: MermaidParse = async (src) => (await mermaid.parse(src, { suppressErrors: true })) !== false;

beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
});

describe("splitReplyDiagrams: a ```mermaid fence in a reply is drawn, not shown as code", () => {
  it("d01: the fence becomes a diagram and the prose around it stays markdown", () => {
    const segments = splitReplyDiagrams(D01);
    expect(segments.map((s) => s.kind)).toEqual(["markdown", "mermaid", "markdown"]);
    expect(segments[1]).toEqual({ kind: "mermaid", code: D01_CODE, closed: true });
    // Nothing is lost or added: the pieces put back together are the reply.
    const [before, , after] = segments as Array<{ text: string }>;
    expect(`${before.text}\n\`\`\`mermaid\n${D01_CODE}\n\`\`\`\n${after.text}`).toBe(D01);
  });

  it("while the fence is still streaming, its source is never in the markdown", () => {
    for (let n = D01.indexOf("```mermaid") + 1; n < D01.indexOf("```\n\nThis"); n++) {
      const segments = splitReplyDiagrams(D01.slice(0, n));
      for (const s of segments) if (s.kind === "markdown") expect(s.text).not.toContain("graph TD");
    }
    const partial = splitReplyDiagrams(D01.slice(0, D01.indexOf("C --> E")));
    expect(partial[partial.length - 1]).toMatchObject({ kind: "mermaid", closed: false });
  });

  it("other code fences stay markdown, and a ```mermaid line inside one is not a fence", () => {
    const other = "Here is the source:\n\n````markdown\n```mermaid\ngraph TD; A --> B\n```\n````\n\nAnd some Python:\n\n```python\nprint(1)\n```\n\n";
    const segments = splitReplyDiagrams(other + D01);
    expect(segments.map((s) => s.kind)).toEqual(["markdown", "mermaid", "markdown"]);
    expect(segments[0]).toEqual({ kind: "markdown", text: `${other}${D01.slice(0, D01.indexOf("```mermaid") - 1)}` });
    expect(segments[1]).toEqual({ kind: "mermaid", code: D01_CODE, closed: true });
  });
});

describe("drawableMermaid: source Mermaid rejects is retried with its labels quoted", () => {
  it.each([["d04", D04], ["d18", D18], ["d20", D20]])("%s: rejected as written, drawn once quoted", async (_id, code) => {
    expect(await parse(code)).toBe(false);
    const drawn = await drawableMermaid(code, parse);
    expect(drawn).not.toBeNull();
    expect(drawn).not.toBe(code);
    expect(await parse(drawn!)).toBe(true);
  });

  it("d18: only the labels change, and d01's source, which parses, is drawn as written", async () => {
    expect(await drawableMermaid(D01_CODE, parse)).toBe(D01_CODE);
    const drawn = await drawableMermaid(D18, parse);
    expect(drawn).toContain('A["Point 1: (x1, y1)"]');
    expect(drawn).toContain('D{"Slope (m) = Rise / Run"}');
    expect(drawn).toContain('-- "Run (x2 - x1)" -->');
    expect(drawn!.replace(/"/g, "")).toBe(D18.replace(/"/g, ""));
  });

});

describe("quoting keeps every node's shape", () => {
  // Circle, hexagon, subroutine, cylinder, stadium, double circle and trapezoid, each with a label
  // Mermaid rejects unquoted. Only the text inside the shape is quoted.
  const SHAPES = "graph TD;\n    A((f(x))) --> B{{g(y)}};\n    B --> C[[h(z)]];\n    C --> D[(k(w))];\n    D --> E([m(v)]);\n    E --> F(((n(u))));\n    F --> G[/p(t)/];";

  it("each shape is drawn with its label quoted inside it", async () => {
    expect(await parse(SHAPES)).toBe(false);
    const drawn = await drawableMermaid(SHAPES, parse);
    for (const node of ['A(("f(x)"))', 'B{{"g(y)"}}', 'C[["h(z)"]]', 'D[("k(w)")]', 'E(["m(v)"])', 'F((("n(u)")))', 'G[/"p(t)"/]']) {
      expect(drawn).toContain(node);
    }
    expect(await parse(drawn!)).toBe(true);
  });

  it("the fallback lists the labels without the shapes' brackets", () => {
    expect(diagramFallback(SHAPES).parts).toEqual(["f(x)", "g(y)", "h(z)", "k(w)", "m(v)", "n(u)", "p(t)"]);
  });
});

describe("diagramFallback: a diagram that cannot be drawn is described, never shown as source", () => {
  it("a broken flowchart lists its labels in plain words", async () => {
    // d18 with its subgraph left open: no quoting can save it.
    const broken = D18.replace(/\n\s*end$/, "").replace("subgraph", "subgraph (");
    expect(await drawableMermaid(broken, parse)).toBeNull();
    const shown = diagramFallback(broken);
    expect(shown.message).toBe("This drawing could not be shown. It was meant to show:");
    expect(shown.parts).toEqual(["Point 1: (x1, y1)", "Point 2: (x2, y2)", "Change in y", "Slope (m) = Rise / Run"]);
    expect(JSON.stringify(shown)).not.toMatch(/graph TD|-->|style |fill:/);
  });

  it("source with no labels to list gets the sentence alone", () => {
    expect(diagramFallback("sequenceDiagram\n  participant A\n  A->>B: hi(")).toEqual({
      message: "This drawing could not be shown. Ask your tutor to explain it in words.",
      parts: [],
    });
  });
});

describe("drawableMermaid: a diagram can't make the webview load from another host (#284)", () => {
  // Mermaid's parsed diagram, to show what it would draw: securityLevel "strict" keeps every one of
  // these URLs, so each "as written" check below is the beacon the preparation has to take out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = async (src: string): Promise<any> => (await mermaid.mermaidAPI.getDiagramFromText(src)).db;
  const HOST = "tracker.example";

  it("an image shape is drawn as a plain box with its label, without the picture", async () => {
    const code = 'flowchart TD\n  A@{ img: "https://tracker.example/cat.png", label: "Cat", pos: "t", w: 60, h: 60 }\n  A --> B';
    expect((await parsed(code)).getVertices().get("A").img).toBe(`https://${HOST}/cat.png`);
    const drawn = await drawableMermaid(code, parse);
    expect(drawn).toBe('flowchart TD\n  A@{ img: "", label: "Cat", pos: "t", w: 60, h: 60 }\n  A --> B');
    const a = (await parsed(drawn!)).getVertices().get("A");
    expect(a.img).toBeUndefined();
    expect(a.text).toBe("Cat");
  });

  it.each([
    ["unquoted, on its own lines", "flowchart TD\n  A@{\n    label: Cat\n    img: https://tracker.example/cat.png\n  }\n  A --> B"],
    ["a quoted key", 'flowchart TD\n  A@{ "img": "https://tracker.example/cat.png", label: "Cat" }'],
    ["an escaped key", 'flowchart TD\n  A@{ "\\x69mg": "https://tracker.example/cat.png", label: "Cat" }'],
    ["a block scalar", "flowchart TD\n  A@{\n    img: >-\n      https://tracker.example/cat.png\n  }"],
  ])("an image shape written with %s loads nothing", async (_how, code) => {
    expect([...(await parsed(code)).getVertices().values()].some((v) => v.img === `https://${HOST}/cat.png`)).toBe(true);
    const drawn = await drawableMermaid(code, parse);
    expect(drawn ?? "").not.toContain(HOST);
    if (drawn !== null) for (const v of (await parsed(drawn)).getVertices().values()) expect(v.img).toBeFalsy();
  });

  it.each([
    ["<img src>", "<img src='https://tracker.example/p.png'>"],
    ["<IMG/SRC>", "<IMG/SRC=https://tracker.example/p.png>"],
    ["<video poster>", "<video poster='https://tracker.example/p.png'></video>"],
    ["<svg><image href>", "<svg><image href='https://tracker.example/p.png'/></svg>"],
    ["a style url()", "<span style='background:url(https://tracker.example/p.png)'>!</span>"],
    ["a style url() behind a character reference", "<span style='background:u&#114;l(https://tracker.example/p.png)'>!</span>"],
    ["an SVG paint url()", "<svg><rect fill='url(https://tracker.example/p.svg#g)'/></svg>"],
  ])("HTML in a label: %s is dropped and the words stay", async (_what, html) => {
    const code = `flowchart TD\n  A["${html} Cat"] --> B`;
    if (html.startsWith("<img")) expect((await parsed(code)).getVertices().get("A").text).toContain(HOST);
    const drawn = await drawableMermaid(code, parse);
    expect(drawn).not.toBeNull();
    expect(drawn).not.toContain(HOST);
    const text = (await parsed(drawn!)).getVertices().get("A").text;
    expect(text).toContain("Cat");
    expect(text).not.toContain(HOST);
  });

  it("a link in a label stays: it is a navigation, not a load", async () => {
    const code = 'flowchart TD\n  A["<a href=\'https://example.org/cats\'>About cats</a>"] --> B';
    expect(await drawableMermaid(code, parse)).toBe(code);
  });

  it.each([
    ["a state classDef", "stateDiagram-v2\n  [*] --> Still\n  classDef hot fill:url(https://tracker.example/p.svg#g)\n  class Still hot"],
    ["a state style", "stateDiagram-v2\n  [*] --> Still\n  style Still background:url(https://tracker.example/p.png)"],
    ["a class diagram style", "classDiagram\n  class Duck\n  style Duck fill:url(https://tracker.example/p.svg#g)"],
    ["a Mermaid character code", "stateDiagram-v2\n  [*] --> Still\n  classDef hot fill:#117;rl(https://tracker.example/p.svg#g)"],
    ["an HTML character reference", "stateDiagram-v2\n  [*] --> Still\n  classDef hot fill:url&lpar;https://tracker.example/p.svg#g&rpar;"],
    ["a CSS escape", "stateDiagram-v2\n  [*] --> Still\n  classDef hot fill:\\75 rl(https://tracker.example/p.svg#g)"],
  ])("CSS that loads in %s: the line is dropped, the diagram drawn", async (_what, code) => {
    const drawn = await drawableMermaid(code, parse);
    expect(drawn).not.toBeNull();
    expect(drawn).not.toContain(HOST);
    expect(drawn!.split("\n").length).toBe(code.split("\n").length - 1);
  });

  it("CSS that only loads across lines leaves the diagram undrawn", async () => {
    expect(await drawableMermaid('flowchart TD\n  A["see url(\nhttps://tracker.example/p.png)"] --> B', parse)).toBeNull();
  });

  it("directives are dropped: themeCSS and fontFamily are CSS", async () => {
    for (const directive of [
      '%%{init: {"themeCSS": ".node rect { fill: url(https://tracker.example/p.svg#g) }"}}%%',
      "%%{init: {'fontFamily': 'x; } @import url(https://tracker.example/f.css); a {'}}%%",
      "%%{init: {\n  'theme': 'forest'\n}}%%",
    ]) {
      const drawn = await drawableMermaid(`${directive}\n${D01_CODE}`, parse);
      expect(drawn).toBe(`\n${D01_CODE}`);
    }
  });

  it("front matter keeps its title and loses its config", async () => {
    const code = `---\ntitle: If and else\nconfig:\n  themeCSS: ".node rect { fill: url(https://tracker.example/p.svg#g) }"\n---\n${D01_CODE}`;
    expect(await drawableMermaid(code, parse)).toBe(`---\ntitle: If and else\n---\n${D01_CODE}`);
  });

  it("a sequence diagram's actor icon (properties, details) is dropped", async () => {
    const code = 'sequenceDiagram\n  participant A\n  properties A: {"class": "x", "icon": "https://tracker.example/i.png"}\n  details A: someElementId\n  A->>B: hi';
    expect((await parsed(code)).getActors().get("A").properties.icon).toBe(`https://${HOST}/i.png`);
    const drawn = await drawableMermaid(code, parse);
    expect(drawn).toBe("sequenceDiagram\n  participant A\n  A->>B: hi");
    expect((await parsed(drawn!)).getActors().get("A").properties).toEqual({});
  });

  it("a diagram with nothing that loads comes back byte for byte", () => {
    const plain = [
      D01_CODE, D04, D18, D20,
      "graph TD;\n    A((f(x))) --> B{{g(y)}};",
      'flowchart LR\n  %% a comment\n  A@{ shape: circle, label: "Start" } --> B["<b>Bold</b><br>next"]\n  B --> C[x<y and y>2]\n  C -->|a<b| D\n  style C fill:#f9f,stroke:#333\n  classDef warm fill:#fde\n  click D href "https://example.org" _blank',
      "---\ntitle: Seasons\n---\nflowchart TD\n  A[Spring] --> B[Summer]",
      "sequenceDiagram\n  participant Alice\n  Alice->>Bob: Hello, url<br>here\n  Note over Alice: thinks",
      "classDiagram\n  Animal <|-- Duck\n  class Duck{\n    +String beakColor\n    +swim()\n  }",
      "stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n  classDef calm fill:#eef",
    ];
    for (const code of plain) expect(withoutRemoteLoads(code)).toBe(code);
  });
});
