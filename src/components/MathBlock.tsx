// Renders a math.render tool result as a typeset KaTeX block, inline in the chat surface
// (V2_ARCHITECTURE.md §6.4). KaTeX is light enough to import eagerly; its CSS rides with this
// component's chunk. Graceful by contract: invalid LaTeX falls back to the raw source so the chat
// never crashes — we never punish the model for imperfect LaTeX (PHASE4_HANDOFF "graceful fallback").

import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
// Register mhchem (\ce{}) on the shared KaTeX singleton. Idempotent + import-order-independent:
// chat-markdown.ts imports it too, but a math.render result can mount before any chat prose does.
import "katex/contrib/mhchem";

export default function MathBlock({ latex }: { latex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { throwOnError: true, displayMode: true });
    } catch {
      return null; // bad LaTeX → fall back to raw text below
    }
  }, [latex]);

  if (html === null) {
    return (
      <div className="lcd rounded-lg px-3 py-2 text-[13px] font-mono text-phosphor-ink overflow-x-auto w-fit max-w-full">
        <code>{latex}</code>
      </div>
    );
  }

  return (
    <div
      className="lcd rounded-lg px-4 py-3 text-phosphor-ink overflow-x-auto w-fit max-w-full"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
