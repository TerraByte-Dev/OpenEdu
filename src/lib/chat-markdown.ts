// Single source of truth for rendering the tutor's chat prose to HTML. ChatTab's streaming bubble and
// its persisted messages both call renderChatMarkdown, as do LessonReader and ResourcesTab.
//
// Math ($…$, $$…$$, \(…\), \[…\], and a few bare commands like \frac) is found by chatMathExtension
// (chat-math.ts, which documents the pairing rules from issue #20) and typeset with KaTeX. Scoped to
// chat ONLY: it must NOT touch NotesTab's global `marked`, where a stray "$" in a note shouldn't be
// parsed as math. mhchem is registered on the shared KaTeX singleton so \ce{} reactions render; that
// also covers MathBlock, which typesets math.render results against the same singleton.
import { Marked } from "marked";
import { chatMathExtension, type TexRenderer } from "./chat-math";
import { sanitizeHtml } from "./sanitize-html";

// KaTeX (~258 KB) is LAZY-loaded the first time chat/resources prose renders, so it stays off the
// startup path (a session with no math never downloads it). Until it resolves, each equation shows as
// its TeX source; the consumer components call ensureChatKatex() on mount and re-render once it's
// ready, so math appears a beat after first paint.
let renderTex: TexRenderer | null = null;
let katexLoading: Promise<void> | null = null;

const chatMarked = new Marked({ gfm: true, breaks: true }).use(chatMathExtension(() => renderTex));

// Idempotent: load KaTeX (+ mhchem for \ce{} + the stylesheet). Safe to call repeatedly; returns the
// same promise.
export function ensureChatKatex(): Promise<void> {
  if (renderTex) return Promise.resolve();
  if (!katexLoading) {
    katexLoading = (async () => {
      const { default: katex } = await import("katex");
      await import("katex/contrib/mhchem"); // registers \ce{} on the shared KaTeX singleton
      await import("katex/dist/katex.min.css");
      // throwOnError: false — a TeX error renders as KaTeX's red source span for that one equation.
      renderTex = (tex, displayMode) => katex.renderToString(tex, { displayMode, throwOnError: false });
    })();
  }
  return katexLoading;
}

export function isChatKatexReady(): boolean {
  return renderTex !== null;
}

export function renderChatMarkdown(text: string): string {
  if (!renderTex) void ensureChatKatex(); // kick off the lazy load; math renders once the consumer re-renders
  // The text is model output, a cached lesson or a library resource: sanitize before it is inlined.
  return sanitizeHtml(chatMarked.parse(text) as string);
}
