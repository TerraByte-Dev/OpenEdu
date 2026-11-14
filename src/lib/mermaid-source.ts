// Mermaid in a tutor reply: what ChatTab and MermaidBlock draw, and what a child sees when a diagram
// cannot be drawn. Pure (the Mermaid parser is passed in), so it is tested without the app.
//
// Two gaps the gemma4:e2b readiness run (B9, 2026-11-13) found:
//   - a model that does not call diagram.render writes the diagram as a ```mermaid fence in its reply,
//     which renderChatMarkdown shows as a code block. splitReplyDiagrams cuts those fences out so the
//     chat draws them through MermaidBlock, the same component a diagram.render result uses.
//   - 3 of the 16 diagrams the model did draw with diagram.render fail mermaid.parse, all on a node
//     label holding ( ) or ": `A[Point 1: (x1, y1)]`, `D[Print "N is Even"]`. Mermaid accepts those
//     labels quoted, so drawableMermaid tries the source with its labels quoted before giving up, and
//     diagramFallback says in plain words what the diagram held instead of showing its source.

export type ReplySegment =
  | { kind: "markdown"; text: string }
  // `closed` is false for a fence the stream has not finished yet.
  | { kind: "mermaid"; code: string; closed: boolean };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;

/**
 * The reply cut into markdown and ```mermaid fences, in order. A reply with no mermaid fence comes back
 * as one markdown segment holding the text unchanged. Other fenced code blocks stay markdown, and a
 * ```mermaid line inside one of them is not a fence.
 */
export function splitReplyDiagrams(text: string): ReplySegment[] {
  const lines = text.split("\n");
  const segments: ReplySegment[] = [];
  let md: string[] = [];
  let i = 0;
  const flush = () => {
    if (md.length) segments.push({ kind: "markdown", text: md.join("\n") });
    md = [];
  };
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open || (open[1][0] === "`" && open[2].includes("`"))) { md.push(lines[i++]); continue; }
    const marker = open[1];
    const isMermaid = open[2].trim().split(/\s+/)[0].toLowerCase() === "mermaid";
    const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    const closed = j < lines.length;
    if (!isMermaid) {
      md.push(...lines.slice(i, closed ? j + 1 : j));
    } else {
      flush();
      segments.push({ kind: "mermaid", code: lines.slice(i + 1, j).join("\n"), closed });
    }
    i = closed ? j + 1 : j;
  }
  flush();
  return segments.length ? segments : [{ kind: "markdown", text }];
}

// Flowchart node shapes, longest opener first: circle, double circle, stadium, subroutine, cylinder,
// hexagon, the four trapezoids, then rectangle, rounded and diamond.
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["(((", ")))"], ["((", "))"], ["([", "])"], ["[[", "]]"], ["[(", ")]"], ["{{", "}}"],
  ["[/", "/]"], ["[/", "\\]"], ["[\\", "\\]"], ["[\\", "/]"],
  ["[", "]"], ["(", ")"], ["{", "}"],
];

interface Label {
  start: number; // index of the label's first character, just past the shape's opener
  end: number;   // index of the shape's closer
  text: string;  // the label, without the shape's brackets
}

// Where the label opened by `open` (ending at `from`) closes: the shape's closer at bracket depth 0 on
// the same line, so `A[f(x)]` is one label. -1 when it does not close there.
function closerAt(code: string, from: number, close: string): number {
  let depth = 0;
  for (let j = from; j < code.length && code[j] !== "\n"; j++) {
    if (depth === 0 && code.startsWith(close, j)) return j;
    const c = code[j];
    if (c === "[" || c === "(" || c === "{") depth++;
    else if (c === "]" || c === ")" || c === "}") { if (--depth < 0) return -1; }
  }
  return -1;
}

// Node labels in a flowchart: an id written straight against a shape's opener, up to that shape's
// closer. Quoted and |piped| text is skipped, so an edge label such as -- "Run (x2 - x1)" --> is not
// read as a node.
function nodeLabels(code: string): Label[] {
  if (!/^\s*(?:graph|flowchart)\b/i.test(code)) return [];
  const labels: Label[] = [];
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "|") {
      const end = code.indexOf(ch, i + 1);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (!"[({".includes(ch) || i === 0 || !/\w/.test(code[i - 1])) continue;
    for (const [open, close] of SHAPES) {
      if (!code.startsWith(open, i)) continue;
      const end = closerAt(code, i + open.length, close);
      if (end < 0) continue;
      labels.push({ start: i + open.length, end, text: code.slice(i + open.length, end) });
      i = end + close.length - 1;
      break;
    }
  }
  return labels;
}

/**
 * The flowchart with every unquoted node label that holds a bracket or a double quote written as a
 * quoted label (`A[Point 1: (x1, y1)]` → `A["Point 1: (x1, y1)"]`, `"` → `#quot;`). Only the text inside
 * the shape is quoted, so a circle stays a circle (`A((f(x)))` → `A(("f(x)"))`). Any other source comes
 * back unchanged.
 */
export function quoteMermaidLabels(code: string): string {
  let out = "";
  let at = 0;
  for (const l of nodeLabels(code)) {
    const t = l.text;
    if (/^".*"$/s.test(t.trim()) || !/[()[\]{}"]/.test(t)) continue;
    out += code.slice(at, l.start) + `"${t.replace(/"/g, "#quot;")}"`;
    at = l.end;
  }
  return out + code.slice(at);
}

/** Parses Mermaid source: true when Mermaid can draw it. */
export type MermaidParse = (code: string) => Promise<boolean>;

/**
 * The source to draw: the model's own if Mermaid parses it, else the same source with its labels
 * quoted if that parses, else null (show diagramFallback).
 */
export async function drawableMermaid(code: string, parse: MermaidParse): Promise<string | null> {
  const ok = async (src: string) => { try { return await parse(src); } catch { return false; } };
  if (await ok(code)) return code;
  const quoted = quoteMermaidLabels(code);
  if (quoted !== code && (await ok(quoted))) return quoted;
  return null;
}

/**
 * What the child sees for a diagram that cannot be drawn: a sentence, and the diagram's node labels
 * in the order they first appear (at most 12), never the Mermaid source.
 */
export function diagramFallback(code: string): { message: string; parts: string[] } {
  const parts: string[] = [];
  for (const l of nodeLabels(code)) {
    const text = l.text.trim().replace(/^"(.*)"$/s, "$1").replace(/#quot;/g, '"').replace(/\s+/g, " ").trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.length
    ? { message: "This drawing could not be shown. It was meant to show:", parts: parts.slice(0, 12) }
    : { message: "This drawing could not be shown. Ask your tutor to explain it in words.", parts: [] };
}
