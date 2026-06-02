// Render-side check for the chat math pipeline (issue #23). Unlike __runEvals (which drives the
// model), this is a pure, deterministic assertion battery over renderChatMarkdown — no Ollama, no
// network. It proves the parser change (nonStandard boundaries + mhchem + \(\)/\[\] normalization)
// actually renders the spans that used to leak as raw source.
//
//     window.__testMathRender()      // logs a table; returns { passed, total, allPass, rows }
//
// Counting: KaTeX emits exactly one `class="katex"` per typeset formula (display math nests its
// single katex span inside a `katex-display` wrapper, which is `class="katex-display"` — it does NOT
// match the bare `class="katex"` token), so this regex count == number of rendered formulas.

import { renderChatMarkdown, ensureChatKatex } from "../chat-markdown";

function countKatex(html: string): number {
  return (html.match(/class="katex"/g) ?? []).length;
}

interface RenderCase {
  name: string;
  input: string;
  expect: number;
  // info cases are reported but never fail the suite — they document accepted tradeoffs.
  info?: boolean;
}

// The first four cases are exactly the boundary failures from issue #23 that standard mode dropped.
const CASES: RenderCase[] = [
  // Paren-hugging inline spans: "(" before the opener, ")" after the closer. Both leaked in standard mode.
  { name: "paren-adjacent inline (physics s vs t)", input: "($s$ vs. $t$)", expect: 2 },
  // Closer immediately followed by ")" — the chemistry leak from the screenshots.
  { name: "closer before ')' (water H2O)", input: "water $\\text{H}_2\\text{O}$)", expect: 1 },
  // mhchem: \ce{} only renders once "katex/contrib/mhchem" is registered on the singleton.
  { name: "mhchem \\ce{} reaction", input: "$\\ce{2H2 + O2 -> 2H2O}$", expect: 1 },
  // Three inline spans in one line, the last comma/period-adjacent — proves "more than one renders".
  { name: "three inline spans", input: "First $a^2$, then $b^2$, finally $c^2 = a^2 + b^2$.", expect: 3 },
  // Standalone display block (the one thing that already worked) — must still render exactly once.
  { name: "display block $$…$$", input: "$$\\Delta x = x_f - x_i$$", expect: 1 },
  // \(…\) / \[…\] LaTeX delimiters get normalized to $…$ / $$…$$ before parsing.
  { name: "normalized \\(…\\) inline", input: "Energy is \\(E = mc^2\\) exactly.", expect: 1 },
  { name: "normalized \\[…\\] display", input: "\\[a^2 + b^2 = c^2\\]", expect: 1 },
  // KNOWN TRADEOFF (informational, never fails): under nonStandard, currency reads as math. The
  // first "$" opens, the next "$" closes, so "$5 apples for $10" yields one (wrong) katex span.
  { name: "currency tradeoff ($5 … $10)", input: "$5 apples for $10", expect: 1, info: true },
];

export async function testMathRender(): Promise<{ passed: number; total: number; allPass: boolean; rows: Array<{ name: string; expect: number; got: number; pass: boolean; info: boolean }> }> {
  await ensureChatKatex(); // KaTeX is lazy-loaded now; make sure it's registered before asserting renders
  const rows = CASES.map((c) => {
    const got = countKatex(renderChatMarkdown(c.input));
    return { name: c.name, expect: c.expect, got, pass: got === c.expect, info: !!c.info };
  });
  // The suite's pass/fail ignores `info` rows (documented tradeoffs), per issue #23.
  const scored = rows.filter((r) => !r.info);
  const passed = scored.filter((r) => r.pass).length;
  const total = scored.length;
  const allPass = passed === total;

  console.table(rows.map((r) => ({ case: r.name, expect: r.expect, got: r.got, result: r.info ? "ℹ info" : r.pass ? "✓" : "✗ FAIL" })));
  console.log(`[render-check] ${passed}/${total} render cases pass${allPass ? " — all green" : " — SEE FAILURES ABOVE"} (+${rows.length - total} informational)`);
  return { passed, total, allPass, rows };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__testMathRender = testMathRender;
}
