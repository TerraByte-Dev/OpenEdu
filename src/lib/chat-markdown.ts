// Single source of truth for rendering the tutor's chat prose to HTML.
//
// The KaTeX extension renders $…$ / $$…$$ in the reply (a safety net for math the model writes
// inline instead of via the math.render tool). Scoped to chat ONLY — it must NOT touch NotesTab's
// global `marked`, where a stray "$" in a note shouldn't be parsed as math.
//
// Two deliberate departures from the extension's defaults (see issue #23):
//   1. nonStandard: true — the standard mode only opens a `$` at index 0 or after a literal space,
//      and only closes before whitespace / a few punctuation marks. That silently drops any inline
//      span that is paren-adjacent — e.g. "($s$ vs. $t$)" — so only standalone $$…$$ blocks rendered.
//      nonStandard relaxes both boundaries so paren/letter-hugging inline math renders too.
//      Known tradeoff: prose like "$5 … $10" now parses as math. Accepted for the tutoring surface.
//   2. mhchem — the side-effect import below registers \ce{} on the shared KaTeX singleton, so
//      chemistry equations (arrows / states / subscripts) render. It also covers MathBlock, which
//      typesets math.render results against the same singleton.
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";

const chatMarked = new Marked({ gfm: true, breaks: true }).use(
  markedKatex({ throwOnError: false, nonStandard: true }),
);

// Models often emit LaTeX's \( … \) (inline) and \[ … \] (display) delimiters instead of $-fences.
// Normalize them to the $-form the KaTeX extension understands before parsing. Done with replacement
// FUNCTIONS (not strings) so a "$" in the body is never treated as a replacement back-reference.
function normalizeMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => "$$" + body + "$$")
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => "$" + body + "$");
}

export function renderChatMarkdown(text: string): string {
  return chatMarked.parse(normalizeMathDelimiters(text)) as string;
}
