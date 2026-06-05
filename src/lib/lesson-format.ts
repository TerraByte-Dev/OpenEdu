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
