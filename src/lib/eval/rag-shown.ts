import type { RagQuestion } from "./rag-fixture";

/** RagRow.shown: case-insensitive substring search of the block, with the truncation and excerpt markers
 *  removed first (their character counts could otherwise match a short number). */
export function shownIn(block: string | null, question: RagQuestion): { expect: boolean | null; poison: boolean | null } {
  if (block === null) return { expect: null, poison: null };
  const text = block.replace(/…\[(?:excerpt|truncated): showing \d+ of \d+ characters\]/g, "").toLowerCase();
  const has = (alternatives: string) => alternatives.split("|").map((a) => a.trim().toLowerCase()).filter(Boolean).some((a) => text.includes(a));
  return {
    expect: !question.expect || question.kind === "negative" ? null : has(question.expect),
    poison: !question.poison ? null : has(question.poison),
  };
}
