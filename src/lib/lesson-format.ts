// Pure lesson assembly (slice A1). The structured lesson the model emits (summary + sections +
// takeaways) is code-assembled into markdown here, then rendered via renderChatMarkdown. Kept
// Tauri-free so it's unit-tested; curriculum.ts owns the model call and persistence.

export interface LessonContent {
  summary: string;
  sections: Array<{ heading: string; body: string }>;
  key_takeaways: string[];
}

// Assemble a structured lesson into note-prose markdown. Pure.
export function assembleLessonMarkdown(title: string, c: LessonContent): string {
  const parts: string[] = [`# ${title}`, ""];
  if (c.summary.trim()) parts.push(c.summary.trim(), "");
  for (const s of c.sections) {
    if (!s.heading.trim() && !s.body.trim()) continue;
    parts.push(`## ${s.heading.trim()}`, "", s.body.trim(), "");
  }
  const takeaways = c.key_takeaways.map((t) => t.trim()).filter(Boolean);
  if (takeaways.length) {
    parts.push("## Key takeaways", "", ...takeaways.map((t) => `- ${t}`), "");
  }
  return parts.join("\n").trim() + "\n";
}

// ─── Completeness ─────────────────────────────────────────────────────────────
// The tiny tier halves minItems, so a one-section lesson whose only section stopped mid-sentence
// ("Matter is anything that has mass (it has") passed the schema on gemma4:e2b and was shown. These
// checks run as callLLMStructured's `validate` hook, so a cut-off section triggers the repair retry.
// They look only for clear signs of a cut: an unclosed code fence, or a last line that leaves a bracket
// open or ends on a word, comma or operator. A section ending in a list, a table, a code block, a
// formula, a "Label: value" line or a rule passes. Checked against 24k gemma4/qwen3.5 replies from the
// k12-flow eval runs, which is how the list, label and rule cases got in.

const LIST_OR_TABLE_LINE = /^(?:[-*+•]\s|\d+[.)]\s|[A-Za-z][.)]\s|\|)/;
// "Final answer: C", "**Correct answer:** B) east", "✅ Tip: draw it". The value is short, so a long
// line cut off after a colon ("Example: if you have 3 apples and you") is still judged as prose,
// unless the value is a lettered option ("Final answer: D) The tilt of Earth's axis ...").
const LABEL_LINE = /^[^\p{L}\d]{0,6}[^:\n]{1,40}:\**\s*(?:\S.{0,40}|\**[A-Za-z][.)]\s.*)$/u;
const RULE_LINE = /^(?:[-*_]\s*){3,}$/;
const ENDS_LIKE_FORMULA = /(?:\$|\\\)|\\\]|```)$/;
const TRAILING_CLOSERS = /["'”’)\]}*_`]+$/;
const SENTENCE_END = /[.!?…:]$/;
const OPERATOR_OR_JOINER = /[,;=+\-−×÷*/<>(\[{&]$/;

// More openers than closers on the line means it was cut inside a bracket. Extra closers are list
// markers ("1)") or a smiley, not a cut.
function unclosedBracket(line: string): boolean {
  const prose = line.replace(/`[^`]*`/g, "").replace(/\$[^$]*\$/g, "");
  return (prose.match(/[([{]/g) ?? []).length > (prose.match(/[)\]}]/g) ?? []).length;
}

/** Whether a section body stops partway through a sentence. Conservative: true only on clear signs. */
export function endsMidSentence(body: string): boolean {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  while (lines.length && RULE_LINE.test(lines[lines.length - 1])) lines.pop();
  if (!lines.length) return false;
  const text = lines.join("\n");
  if ((text.match(/```/g) ?? []).length % 2 === 1) return true;
  if (ENDS_LIKE_FORMULA.test(text)) return false;

  const last = lines[lines.length - 1];
  if (unclosedBracket(last)) return true;
  // "**C) the governor**" is a list line in bold; "[6x - 15 + 4x]" is a bracketed formula line.
  const unbold = last.replace(/^[*_]+(?=\S)/, "");
  if (LIST_OR_TABLE_LINE.test(unbold) || LABEL_LINE.test(last) || /^\[.*\]$/.test(last)) return false;

  // A sentence followed by a closed aside ("... expected. (Correct)") is finished.
  if (SENTENCE_END.test(last.replace(/\s*\([^()]*\)$/, "").replace(TRAILING_CLOSERS, ""))) return false;
  const bare = last.replace(TRAILING_CLOSERS, "");
  if (!bare || SENTENCE_END.test(bare)) return false;
  if (OPERATOR_OR_JOINER.test(bare)) return true;
  // A worked line ("Area = 3 × 4 = 12", "F = ma") or an emoji sign-off ends without a full stop.
  if (bare.includes("=") || /\p{Extended_Pictographic}$/u.test(bare)) return false;
  // A digit or symbol ending ("... is 12", "πr²") is not a clear cut; a word ending is.
  return /\p{L}$/u.test(bare);
}

/** The `validate` hook for a lesson: one issue per section that stops mid-sentence. */
export function lessonIssues(c: LessonContent): string[] {
  return c.sections
    .filter((s) => endsMidSentence(s.body))
    .map((s) => `Section "${s.heading.trim().slice(0, 60)}" stops mid-sentence ("…${s.body.trimEnd().slice(-40)}"). ` +
      `Finish every section with a complete sentence.`);
}
