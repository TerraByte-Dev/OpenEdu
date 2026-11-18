// What a math.render or diagram.render call leaves in the reply. Pure; TutorEngine calls it.
//
// The two tools only echo their argument, and the chat used to draw that from the turn's live tool
// events, which are cleared at the next message and never saved. So the equation or diagram was gone
// from the conversation the moment the child wrote again, and from the thread when it was reopened,
// while the saved reply still said "look at the formula above". Now the kernel shows the drawing as
// reply text at the point the call ran, in the two forms the chat already draws from a reply: a `$$`
// display block (chat-math.ts) and a ```` ```mermaid ```` fence (mermaid-source.ts). It is streamed,
// saved, read aloud ("A drawing", the LaTeX as words) and in the model's history like any reply text.

const MATH_TOOL = "math.render";
const DIAGRAM_TOOL = "diagram.render";

// Delimiters a model sometimes puts around the LaTeX anyway: $$…$$, \[…\], $…$ or \(…\).
const WRAPPED_TEX = /^(?:\$\$([\s\S]*)\$\$|\\\[([\s\S]*)\\\]|\$([\s\S]*)\$|\\\(([\s\S]*)\\\))$/;
// A fence the model put around the Mermaid source anyway.
const WRAPPED_MERMAID = /^(`{3,}|~{3,})[ \t]*(?:mermaid)?[ \t]*\n([\s\S]*?)\n[ \t]*\1[`~]*[ \t]*$/i;

/** The `$$` block a math.render call's LaTeX is shown as, or null when there is nothing to draw. */
export function mathBlock(latex: string): string | null {
  let tex = latex.replace(/\r\n?/g, "\n").trim();
  const wrapped = WRAPPED_TEX.exec(tex);
  if (wrapped) tex = (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4]).trim();
  // A display block never spans a blank line (chat-math.ts BLOCK_RE), and a blank line means nothing in TeX.
  tex = tex.replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");
  return tex ? `$$\n${tex}\n$$` : null;
}

/** The ```mermaid fence a diagram.render call's source is shown as, or null when there is nothing to draw. */
export function mermaidFence(mermaid: string): string | null {
  let src = mermaid.replace(/\r\n?/g, "\n").trim();
  const wrapped = WRAPPED_MERMAID.exec(src);
  if (wrapped) src = wrapped[2].trim();
  if (!src) return null;
  // Longer than any run of backticks in the source, so no line of it can close the fence.
  const longest = Math.max(0, ...(src.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}mermaid\n${src}\n${fence}`;
}

/**
 * The text a successful call shows after `before` (the turn's text so far): the drawing on its own
 * lines, or "" for any other tool or an argument with nothing to draw. Whatever is shown next starts a
 * new paragraph after it (TutorEngine `show`).
 */
export function drawnCard(before: string, name: string, args: unknown): string {
  const arg = (key: string) => {
    const v = args && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
    return typeof v === "string" ? v : "";
  };
  const block = name === MATH_TOOL ? mathBlock(arg("latex")) : name === DIAGRAM_TOOL ? mermaidFence(arg("mermaid")) : null;
  if (!block) return "";
  const sep = !before.trim() ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  return sep + block;
}
