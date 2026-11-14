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
//
// And one the privacy audit found (#284): Mermaid source can make the webview fetch from any host, so
// drawableMermaid takes that syntax out before anything is drawn (withoutRemoteLoads).
//
// Two more from the rerun (B9 r1, 2026-11-14): a flowchart that is valid except for a stray `}` at its
// end (drawableMermaid tries it without the unmatched closers), and Mermaid written into the reply with
// no fence at all, a "mermaid" line and then "graph TD" (fenceBareMermaid fences it, so it is drawn
// like any other).

import { cssLoadsRemote } from "./remote-url";

export type ReplySegment =
  | { kind: "markdown"; text: string }
  // `closed` is false for a fence the stream has not finished yet.
  | { kind: "mermaid"; code: string; closed: boolean };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;

// ---- Mermaid with no fence ----
// A diagram's first line. Case-sensitive, as Mermaid reads them. A flowchart needs its direction and
// nothing after it but `;` and statements, so prose that happens to start with "graph TD" is not one;
// the other types are a keyword alone on a line.
const BARE_HEADER = /^[ \t]*(?:(?:graph|flowchart)[ \t]+(?:TD|TB|BT|RL|LR)[ \t]*(?:;.*)?|(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|mindmap|gitGraph|journey|timeline|quadrantChart|xychart-beta|block-beta)[ \t]*|pie(?:[ \t]+(?:showData|title\b.*))?[ \t]*)$/;
// After a "mermaid" label line, also a flowchart with no direction and the rarer diagram types.
const LABELLED_HEADER = /^[ \t]*(?:(?:graph|flowchart)[ \t]*(?:;.*)?|(?:C4\w+|requirementDiagram|sankey-beta|packet-beta|architecture-beta|kanban|radar-beta)[ \t]*)$/;
const LABEL_LINE = /^[ \t]*mermaid[ \t]*:?[ \t]*$/i;
// A line that reads as diagram source rather than prose: an edge, a node shape straight after an id,
// a keyword statement, or a lone `}` or `;`.
const DIAGRAM_LINE = /-->|---|==>|-\.->|--[ \t]|<-->|->>|^[ \t]*(?:subgraph|end|style|classDef|class|linkStyle|click|direction|participant|actor|Note[ \t]+(?:left|right|over)|loop|alt|opt|par|rect|activate|deactivate|state|section|title|dateFormat|axisFormat)\b|^[ \t]*[\w-]+[ \t]*(?:\[|\(|\{|>)|^[ \t]*[};]+[ \t]*$/;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The reply with any Mermaid written outside a fence put inside a ```mermaid fence, so the chat draws
 * it (or, when it cannot, shows a sentence) instead of showing the source. Two forms are read: a line
 * that says only "mermaid" followed by a diagram's first line (the label line is dropped), and a
 * diagram's first line on its own (`graph TD`, `flowchart LR`, `sequenceDiagram`, ...). The diagram runs
 * while its lines read as diagram source or are indented, and across a blank line only when the next
 * line is indented diagram source. A diagram at the end of the text (blank lines aside) is left
 * unclosed, as a fence still streaming is. Text inside fenced code is never read. A reply with none comes back unchanged.
 */
export function fenceBareMermaid(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: RegExp | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      out.push(line);
      if (fence.test(line)) fence = null;
      continue;
    }
    const open = FENCE_LINE.exec(line);
    if (open) {
      out.push(line);
      fence = new RegExp(`^ {0,3}${open[1][0] === "`" ? "`" : "~"}{${open[1].length},}[ \\t]*$`);
      continue;
    }
    const labelled = LABEL_LINE.test(line) && i + 1 < lines.length && (BARE_HEADER.test(lines[i + 1]) || LABELLED_HEADER.test(lines[i + 1]));
    if (!labelled && !BARE_HEADER.test(line)) { out.push(line); continue; }
    const start = labelled ? i + 1 : i;
    let end = start + 1; // exclusive
    while (end < lines.length) {
      const l = lines[end];
      if (l.trim() && (DIAGRAM_LINE.test(l) || /^[ \t]/.test(l))) { end++; continue; }
      if (!l.trim()) {
        let next = end;
        while (next < lines.length && !lines[next].trim()) next++;
        // Only blank lines left: the text ends here (or its next line is still streaming), so the
        // diagram runs to the end and stays open.
        if (next === lines.length) { end = next; break; }
        if (/^[ \t]/.test(lines[next]) && DIAGRAM_LINE.test(lines[next])) { end = next; continue; }
      }
      break;
    }
    out.push("```mermaid", ...lines.slice(start, end));
    if (end < lines.length) out.push("```");
    changed = true;
    i = end - 1;
  }
  return changed ? out.join("\n") : text;
}

/**
 * The reply cut into markdown and ```mermaid fences, in order. A reply with no mermaid fence comes back
 * as one markdown segment holding the text unchanged. Other fenced code blocks stay markdown, and a
 * ```mermaid line inside one of them is not a fence. Mermaid with no fence is read as fenced
 * (fenceBareMermaid).
 */
export function splitReplyDiagrams(reply: string): ReplySegment[] {
  const text = fenceBareMermaid(reply);
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
  return segments.length ? segments : [{ kind: "markdown", text: reply }];
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

// ---- Remote loads (#284) ----
// A diagram must not make the webview fetch from another host: like a remote <img> in a reply
// (sanitize-html.ts), the request tells that host when the learner opened the diagram, and its URL can
// carry words from the conversation. securityLevel "strict" stops none of the following in Mermaid 11,
// and Mermaid draws (and so loads) in the live page before its output could be cleaned, so the syntax
// is taken out of the source:
//   - %%{init}%% directives and front-matter `config`: themeCSS, fontFamily and themeVariables are CSS,
//     where @import and url() load. Every directive is dropped (the app sets the theme), and front
//     matter keeps only its top-level title and displayMode lines.
//   - image shapes, A@{ img: "https://…" }: Mermaid loads the picture to measure it. The img value is
//     blanked, so the node is drawn as a plain box with its label; shape data whose img can't be
//     blanked that way (an escaped key such as "\x69mg") is dropped whole. A block-scalar value leaves
//     YAML Mermaid rejects, so that diagram is not drawn at all.
//   - sequence diagram actor `properties` (an "icon" URL is drawn as an <image>) and `details` (reads
//     those properties out of any element in the page by id): the lines are dropped.
//   - HTML in labels: strict mode lets <img src>, <video poster>, <svg><image href> and friends through
//     Mermaid's own DOMPurify. A tag with an attribute that can load (or CSS that could) is dropped,
//     its text kept. <a href> stays: a link is a navigation, not a load.
//   - CSS that loads: a line whose CSS would fetch from another host (style, classDef, linkStyle, C4
//     $bgColor, …) is dropped.
// What stays, and why: click/link/links hrefs are navigations (#284 item 1, the navigation guard), and
// strict mode already ignores click callbacks; icons (fa:, @{ icon }, architecture) come only from
// icon packs the app registers, and it registers none. A diagram with none of the above comes back
// byte for byte.

// Mermaid's own patterns (mermaid/src/diagram-api/regexes.ts), so exactly what it reads is removed.
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const FRONT_MATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;
const FRONT_MATTER_KEPT = /^(?:(?:title|displayMode)\s*:.*|#.*|\s*)$/;

// An HTML start tag, to its `>` or, unclosed, as far as it could reach.
const TAG = /<([a-z][^\s/>]*)([^<>]*)>?/gi;
const LOAD_ATTR = /(?:^|[\s/"'])(?:src|srcset|poster|background|data|action|formaction|codebase|lowsrc|dynsrc|xlink:href|href)\s*=/i;
const LINK_HREF = /(?:^|[\s/"'])(?:xlink:)?href\s*=/gi;
// Attribute text that could hold CSS that loads, or hide it behind a character reference or escape.
const CSS_IN_ATTRS = /url|image-set|import|src\s*\(|[\\&]/i;

/**
 * The tag loads something (or might): any load attribute but a link's href, or an attribute value that
 * could hold CSS that loads. Without an `=` there is no value to load, so `x<y` in a label stays.
 */
function tagLoads(name: string, attrs: string): boolean {
  const isLink = /^(?:a|area)$/i.test(name);
  return LOAD_ATTR.test(isLink ? attrs.replace(LINK_HREF, " ") : attrs) || (attrs.includes("=") && CSS_IN_ATTRS.test(attrs));
}

// Character references undone so `&#117;rl(`, `url&lpar;` or Mermaid's own `#117;rl(` can't hide a load
// from cssLoadsRemote: Mermaid turns its #…; codes into HTML references, and classDef CSS lands in the
// SVG's <style>, where the HTML parser decodes them. A DOMParser document is inert: parsing loads nothing.
function decodeRefs(text: string): string {
  const t = text.replace(/#(\w+);/g, (_, e: string) => (/^\+?\d+$/.test(e) ? `&#${e};` : `&${e};`));
  if (!t.includes("&") || typeof DOMParser === "undefined") return t;
  const doc = new DOMParser().parseFromString(`<textarea>${t.replace(/</g, "&lt;")}</textarea>`, "text/html");
  return doc.querySelector("textarea")?.value ?? t;
}

// Where shape data opened at `from` (just past "@{") ends, past its "}": the first } outside double
// quotes, as Mermaid's lexer reads it.
function shapeDataEnd(code: string, from: number): number {
  let inString = false;
  for (let i = from; i < code.length; i++) {
    if (code[i] === '"') inString = !inString;
    else if (code[i] === "}" && !inString) return i + 1;
  }
  return code.length;
}

const IMG_ENTRY = /(^|[{,\s])(["']?)img\2(\s*:)[ \t]*("[^"\n]*"|'(?:[^'\n]|'')*'|[^,}\n]*)/g;
const BLANK_IMG = /(["']?)img\1\s*:\s*""/g;

/** Shape data `{…}` with its img value blanked, or null when an img could survive that. */
function withoutImg(data: string): string | null {
  if (!/\bimg\b|\\/.test(data)) return data;
  const blanked = data.replace(IMG_ENTRY, '$1$2img$2$3 ""');
  return /\bimg\b|\\/.test(blanked.replace(BLANK_IMG, "")) ? null : blanked;
}

/**
 * The diagram with every piece of syntax that would make the webview load from another host taken out
 * (see the list above). Source with none comes back unchanged.
 */
export function withoutRemoteLoads(code: string): string {
  let out = code;

  const fm = FRONT_MATTER.exec(out);
  if (fm) {
    const body = fm[2].split(/\r?\n|\r/).map((l) => (fm[1] && l.startsWith(fm[1]) ? l.slice(fm[1].length) : l));
    if (!body.every((l) => FRONT_MATTER_KEPT.test(l))) {
      const kept = body.filter((l) => /^(?:title|displayMode)\s*:/.test(l));
      out = (kept.length ? `---\n${kept.join("\n")}\n---\n` : "") + out.slice(fm[0].length);
    }
  }

  for (let prev = ""; prev !== out; ) { prev = out; out = out.replace(DIRECTIVE, ""); }

  out = out.replace(TAG, (tag, name: string, attrs: string) => (tagLoads(name, attrs) ? "" : tag));

  for (let at = out.indexOf("@{"); at >= 0; at = out.indexOf("@{", at + 1)) {
    const end = shapeDataEnd(out, at + 2);
    const data = out.slice(at + 1, end);
    const safe = withoutImg(data);
    if (safe === data) continue;
    out = out.slice(0, at) + (safe === null ? "" : `@${safe}`) + out.slice(end);
  }

  const lines = out.split("\n");
  const firstLine = lines.find((l) => l.trim() && !/^\s*(?:%%|---|title\s*:|displayMode\s*:)/.test(l)) ?? "";
  const isSequence = /^\s*sequenceDiagram\b/.test(firstLine);
  const kept = lines.filter(
    (l) => !(isSequence && /^\s*(?:properties|details)\b/i.test(l)) && !cssLoadsRemote(decodeRefs(l)),
  );
  return kept.length === lines.length ? out : kept.join("\n");
}

/** Parses Mermaid source: true when Mermaid can draw it. */
export type MermaidParse = (code: string) => Promise<boolean>;

/**
 * A flowchart with the `}`s at its very end that close nothing taken off (`… D --> E;\n}` →
 * `… D --> E;`), or the source unchanged. Braces inside quotes or |edge text| are not counted, so a
 * diamond's own `}` is never removed.
 */
export function withoutStrayClosers(code: string): string {
  if (!/^\s*(?:graph|flowchart)\b/i.test(code)) return code;
  let depth = 0;
  let excess = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"' || ch === "|") {
      const end = code.indexOf(ch, i + 1);
      if (end < 0) break;
      i = end;
    } else if (ch === "{") depth++;
    else if (ch === "}") { if (depth > 0) depth--; else excess++; }
  }
  const end = code.replace(/\s+$/, "");
  let out = end;
  while (excess > 0 && out.endsWith("}")) {
    out = out.slice(0, -1).replace(/\s+$/, "");
    excess--;
  }
  return out === end ? code : out;
}

/**
 * The source to draw: the model's own (with anything that would load from another host taken out,
 * withoutRemoteLoads) if Mermaid parses it, else the same source with its labels quoted if that
 * parses; failing both, the same two tries without a stray `}` at its end (withoutStrayClosers); else
 * null (show diagramFallback). Also null when CSS that loads still spans lines.
 */
export async function drawableMermaid(code: string, parse: MermaidParse): Promise<string | null> {
  const ok = async (src: string) => { try { return await parse(src); } catch { return false; } };
  const safe = withoutRemoteLoads(code);
  if (cssLoadsRemote(decodeRefs(safe))) return null;
  const trimmed = withoutStrayClosers(safe);
  for (const base of trimmed === safe ? [safe] : [safe, trimmed]) {
    if (await ok(base)) return base;
    const quoted = quoteMermaidLabels(base);
    if (quoted !== base && (await ok(quoted))) return quoted;
  }
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
