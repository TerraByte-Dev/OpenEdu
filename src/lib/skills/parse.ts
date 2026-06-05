// Frontmatter parser for skill .md bundles (docs/ARCHITECTURE.md). Splits the leading `---`
// fenced block from the markdown body and parses a small YAML subset — scalars, one level of
// nesting, and arrays written inline (`[a, b]`) or as a block (`- item`). The result is a plain
// object handed to SkillFrontmatterSchema for validation/coercion, so this stays intentionally
// minimal; swap in a real YAML lib only if user-sideloaded skills ever need richer frontmatter.

export interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseSkillFile(raw: string): ParsedSkillFile {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: {}, body: text.trim() };
  return { frontmatter: parseFrontmatter(m[1]), body: m[2].trim() };
}

function parseFrontmatter(block: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) { i++; continue; }
    if (indentOf(line) > 0) { i++; continue; } // stray indented line with no parent — skip
    const { key, value } = splitKeyValue(line);
    if (value !== "") { root[key] = parseValue(value); i++; continue; }

    // Empty value → a nested object and/or a block list on the following indented lines.
    const child: Record<string, unknown> = {};
    const list: unknown[] = [];
    i++;
    while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > 0)) {
      const t = lines[i].trim();
      if (t === "" || t.startsWith("#")) { i++; continue; }
      if (t.startsWith("- ")) list.push(parseScalar(t.slice(2).trim()));
      else { const kv = splitKeyValue(t); child[kv.key] = parseValue(kv.value); }
      i++;
    }
    root[key] = list.length ? list : child;
  }
  return root;
}

const indentOf = (line: string) => line.length - line.trimStart().length;

function splitKeyValue(line: string): { key: string; value: string } {
  const idx = line.indexOf(":");
  if (idx === -1) return { key: line.trim(), value: "" };
  return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
}

function parseValue(raw: string): unknown {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    return inner ? inner.split(",").map((s) => parseScalar(s.trim())) : [];
  }
  return parseScalar(raw);
}

function parseScalar(raw: string): unknown {
  return raw.replace(/^['"]|['"]$/g, "");
}
