// Math tokenizing for chat prose (issue #20). A marked extension that finds LaTeX in a tutor reply and
// hands each equation to a renderer (KaTeX, injected by chat-markdown.ts so this module stays pure).
//
// Why not marked-katex-extension: its paragraph-level `$$` rule has no start(), so a display block
// written straight after a sentence ("The formula is:\n$$\n…\n$$") was swallowed into the paragraph,
// where the inline rule (no newlines) could not match it and it leaked as raw source. Its nonStandard
// mode also pairs `$` greedily, so one currency "$5" or one unclosed "$" shifted every later pair.
//
// What this accepts:
//   $…$ and \(…\)       inline        $$…$$ and \[…\]  display (may span lines, never a blank line)
//   \frac{a}{b}, \sqrt{x}, \times, \pi …  bare LaTeX the model forgot to fence (a fixed small list)
// Code spans and code blocks never reach these tokenizers: marked consumes them first.
//
// Pairing rules for a single $ (the one that collides with prose). Each span is judged on its own,
// so a rejected $ is shown as text and the next $ is tried as an opener. One bad delimiter costs at
// most itself, never the equations after it.
//   - the closer is the next unescaped $ on the same line, and the content is not blank
//   - a digit straight after the closer means currency ("$5 to $10")
//   - an opener followed by a digit with a space before the closer is currency ("$5 and $")
//   - a closer with a space before it and a word right after it is really the next opener
//     ("$x = 5 and then $y$": the middle $ opens $y$)
//   - two plain words of 3+ letters in a row (outside \text{}) are prose, not math
import type { MarkedExtension, Tokens } from "marked";

export type TexRenderer = (tex: string, displayMode: boolean) => string;

export interface MathMatch {
  raw: string;
  tex: string;
  display: boolean;
}

// Bare LaTeX the tutor commonly writes without delimiters. Braces nest up to three levels deep.
const BAL = String.raw`\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const BARE_RE = new RegExp(
  String.raw`^(?:\\(?:[dt]?frac|binom)\s*${BAL}\s*${BAL}|\\sqrt(?:\[[^\]\n]*\])?\s*${BAL}` +
    String.raw`|\\(?:times|div|pm|mp|cdot|leq?|geq?|neq?|approx|infty|pi|theta|alpha|beta|Delta)(?![A-Za-z]))`,
);

const PROSE_RE = /[A-Za-z]{3,}[ \t]+[A-Za-z]{3,}/;
const TEXT_GROUP_RE = /\\(?:text\w*|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

function looksLikeProse(tex: string): boolean {
  return PROSE_RE.test(tex.replace(TEXT_GROUP_RE, " ").replace(/\\[A-Za-z]+/g, " "));
}

// Index of the next `delim` at or after `from` that is not backslash-escaped, or -1. With
// `stopAtNewline`, a newline ends the search; otherwise a blank line does (paragraphs never pair).
function findCloser(src: string, delim: string, from: number, stopAtNewline: boolean): number {
  for (let i = from; i < src.length; i++) {
    if (src.startsWith(delim, i)) return i;
    const ch = src[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "\n" && (stopAtNewline || /^\n[ \t]*\n/.test(src.slice(i)))) return -1;
  }
  return -1;
}

function pair(src: string, open: string, close: string, display: boolean): MathMatch | null {
  const end = findCloser(src, close, open.length, false);
  if (end < 0) return null;
  const tex = src.slice(open.length, end).trim();
  return tex ? { raw: src.slice(0, end + close.length), tex, display } : null;
}

function singleDollar(src: string): MathMatch | null {
  const end = findCloser(src, "$", 1, true);
  if (end < 0) return null;
  const body = src.slice(1, end);
  const tex = body.trim();
  if (!tex) return null;
  const after = src[end + 1] ?? "";
  const spaceBefore = /\s/.test(src[end - 1]);
  if (/\d/.test(after)) return null;
  if (spaceBefore && /\d/.test(src[1])) return null;
  if (spaceBefore && /[A-Za-z0-9\\({[]/.test(after)) return null;
  if (looksLikeProse(tex)) return null;
  return { raw: src.slice(0, end + 1), tex, display: false };
}

// Math that starts exactly at src[0], or null.
export function matchInlineMath(src: string): MathMatch | null {
  if (src.startsWith("$$")) return pair(src, "$$", "$$", true);
  if (src.startsWith("$")) return singleDollar(src);
  if (src.startsWith("\\(")) return pair(src, "\\(", "\\)", false);
  if (src.startsWith("\\[")) return pair(src, "\\[", "\\]", true);
  const bare = BARE_RE.exec(src);
  return bare ? { raw: bare[0], tex: bare[0], display: false } : null;
}

// First index where matchInlineMath succeeds. Escaped characters (\$) are skipped, and a rejected $
// or $$ is skipped so the scan moves on to the next candidate opener.
export function findInlineMathStart(src: string): number | undefined {
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== "$" && ch !== "\\") continue;
    if (matchInlineMath(src.slice(i))) return i;
    if (ch === "\\" || src[i + 1] === "$") i++;
  }
  return undefined;
}

// A display block on its own lines: $$ or \[ at a line start, closer at a line end.
const BLOCK_RE = /^ {0,3}(?:\$\$((?:\\[\s\S]|(?!\n[ \t]*\n)[^\\$]|\$(?!\$))+?)\$\$|\\\[((?:(?!\\\])(?!\n[ \t]*\n)[\s\S])+?)\\\])[ \t]*(?:\n|$)/;

export function matchBlockMath(src: string): MathMatch | null {
  const m = BLOCK_RE.exec(src);
  if (!m) return null;
  const tex = (m[1] ?? m[2]).trim();
  return tex ? { raw: m[0], tex, display: true } : null;
}

function findBlockMathStart(src: string): number | undefined {
  const lineStart = /(?:^|\n)( {0,3}(?:\$\$|\\\[))/g;
  for (let m = lineStart.exec(src); m; m = lineStart.exec(src)) {
    const at = m.index + m[0].length - m[1].length;
    if (matchBlockMath(src.slice(at))) return at;
    lineStart.lastIndex = at + 1;
  }
  return undefined;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// `getRenderer` is read at render time, so chat-markdown can swap KaTeX in once it has lazy-loaded.
// With no renderer yet, or if the renderer throws, the equation shows as its own escaped TeX source:
// one equation falls back, the rest of the message is unaffected.
export function chatMathExtension(getRenderer: () => TexRenderer | null): MarkedExtension {
  const render = (token: Tokens.Generic) => {
    const renderer = getRenderer();
    if (renderer) {
      try {
        return renderer(token.text, token.displayMode) + (token.type === "blockMath" ? "\n" : "");
      } catch {
        /* fall through to the source fallback */
      }
    }
    return `<code class="math-fallback">${escapeHtml(token.raw.trim())}</code>`;
  };
  return {
    extensions: [
      {
        name: "blockMath",
        level: "block",
        start: findBlockMathStart,
        tokenizer(src) {
          const m = matchBlockMath(src);
          return m ? { type: "blockMath", raw: m.raw, text: m.tex, displayMode: true } : undefined;
        },
        renderer: render,
      },
      {
        name: "inlineMath",
        level: "inline",
        start: findInlineMathStart,
        tokenizer(src) {
          const m = matchInlineMath(src);
          return m ? { type: "inlineMath", raw: m.raw, text: m.tex, displayMode: m.display } : undefined;
        },
        renderer: render,
      },
    ],
  };
}
