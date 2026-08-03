// Notebook linking primitives — pure, Tauri-free, unit-tested (notebook-links.test.ts).
//
// Two linking syntaxes live in a note's markdown content; neither needs a DB column:
//   - [[wiki link]] — references another NOTE by title (resolves case-insensitively).
//   - #tag          — a note-FREE label. Clicking one opens a filtered view of every
//                     note carrying it; it never materializes a note.
//
// The editor (MarkdownEditor) and the vault UI (NotesTab) both import from here so the
// regex + resolution rules have a single source of truth (and so the graph can grow tag
// nodes without anyone re-deriving the parser).

import type { Note, NotebookFolder } from "../types";

// ── Syntax ────────────────────────────────────────────────────────────────────
// A [[wiki link]] is any run of non-"]" characters between double brackets, ON ONE LINE.
// The newline exclusion is load-bearing: without it a stray unclosed "[[" swallows every character up
// to the next "]]" anywhere later in the document, so one typo silently invents a link — with a title
// containing paragraphs — that then shows up in the graph, in backlinks, and as a giant underline in
// the editor. Obsidian doesn't let a link span lines either.
export const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g;
// A #tag is "#" + a letter-led word ([A-Za-z][\w-]*) that sits at the start of the text
// or right after whitespace — so "C#", "a#b", and "#1" are deliberately NOT tags.
export const TAG_RE = /(?:^|\s)#([A-Za-z][\w-]*)/g;

export interface WikiLinkSpan {
  /** Link target title, trimmed (the text between the brackets). */
  title: string;
  /** Offset of the opening "[[" within the scanned string. */
  start: number;
  /** Offset just past the closing "]]". */
  end: number;
}

export interface TagSpan {
  /** Tag name without its leading "#". */
  tag: string;
  /** Offset of the "#" within the scanned string. */
  start: number;
  /** Offset just past the final tag character. */
  end: number;
}

// Fresh RegExp per scan — never call .exec on the exported globals directly (shared lastIndex).
const fresh = (re: RegExp) => new RegExp(re.source, "g");

/** Every [[wiki link]] in `text`, with bracket-inclusive spans, in document order. */
export function findWikiLinks(text: string): WikiLinkSpan[] {
  const out: WikiLinkSpan[] = [];
  const re = fresh(WIKI_LINK_RE);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ title: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Every #tag in `text`, with spans anchored at the "#", in document order. */
export function findTags(text: string): TagSpan[] {
  const out: TagSpan[] = [];
  const re = fresh(TAG_RE);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // m[0] may include the leading whitespace boundary — anchor the span at the "#".
    const start = m.index + m[0].indexOf("#");
    out.push({ tag: m[1], start, end: start + 1 + m[1].length });
  }
  return out;
}

/** Unique tag names in `content`, first-seen order, case preserved. */
export function extractTags(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { tag } of findTags(content)) {
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

/** Unique [[wiki link]] titles in `content`, first-seen order, deduped case-insensitively. */
export function extractWikiTitles(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { title } of findWikiLinks(content)) {
    if (!title) continue;
    const k = linkKey(title);
    if (!seen.has(k)) { seen.add(k); out.push(title); }
  }
  return out;
}

/** Title comparison key — links resolve case-insensitively / trimmed, like Obsidian. */
export const linkKey = (title: string): string => title.trim().toLowerCase();

/** Resolve a [[link]] title to an existing note (case-insensitive), or null when missing. */
export function resolveWikiLink<T extends { title: string }>(title: string, notes: readonly T[]): T | null {
  const k = linkKey(title);
  return notes.find((n) => linkKey(n.title) === k) ?? null;
}

/** tag -> the notes carrying it (each note listed once per distinct tag it contains). */
export function buildTagIndex<T extends { content: string }>(notes: readonly T[]): Map<string, T[]> {
  const idx = new Map<string, T[]>();
  for (const n of notes) {
    for (const tag of extractTags(n.content)) {
      const bucket = idx.get(tag) ?? (idx.set(tag, []).get(tag)!);
      bucket.push(n);
    }
  }
  return idx;
}

// ── Backlinks ─────────────────────────────────────────────────────────────────
// The half of bidirectional linking the UI was missing: a note knowing who points AT it. Obsidian
// splits this in two, and the distinction matters — a LINKED mention is an explicit [[link]] someone
// wrote, an UNLINKED mention is a note that happens to say the title in prose. The first is a fact
// about the vault; the second is a suggestion.

export interface Mention {
  /** The note doing the mentioning. */
  note: Note;
  /** One entry per occurrence — the line it appears on, trimmed. */
  contexts: string[];
}

/** How much of a long context line to keep on each side of the mention. */
const CONTEXT_PAD = 90;

/** The line `offset` falls on, trimmed, and elided around the hit when the line is long. */
function contextAt(content: string, offset: number, hitLen: number): string {
  let start = content.lastIndexOf("\n", offset - 1) + 1;
  let end = content.indexOf("\n", offset);
  if (end === -1) end = content.length;

  const relStart = offset - start;
  let line = content.slice(start, end);
  let prefix = "";
  let suffix = "";

  if (relStart > CONTEXT_PAD) {
    line = line.slice(relStart - CONTEXT_PAD);
    prefix = "…";
  }
  const cut = (prefix ? CONTEXT_PAD : relStart) + hitLen + CONTEXT_PAD;
  if (line.length > cut) {
    line = line.slice(0, cut);
    suffix = "…";
  }
  return (prefix + line.trim() + suffix).trim();
}

/**
 * noteId -> the notes containing an explicit [[link]] that resolves to it.
 * Self-links are ignored (a note listing itself as a backlink is noise, and Obsidian does the same).
 */
export function buildBacklinkIndex(notes: readonly Note[]): Map<string, Mention[]> {
  const byKey = new Map<string, Note>();
  for (const n of notes) byKey.set(linkKey(n.title), n);

  const out = new Map<string, Mention[]>();
  for (const source of notes) {
    // Group this source's hits per target so a note linking three times is ONE entry with three
    // contexts, not three entries.
    const perTarget = new Map<string, string[]>();
    for (const { title, start } of findWikiLinks(source.content)) {
      const target = byKey.get(linkKey(title));
      if (!target || target.id === source.id) continue;
      const bucket = perTarget.get(target.id) ?? perTarget.set(target.id, []).get(target.id)!;
      bucket.push(contextAt(source.content, start, title.length + 4));
    }
    for (const [targetId, contexts] of perTarget) {
      (out.get(targetId) ?? out.set(targetId, []).get(targetId)!).push({ note: source, contexts });
    }
  }
  return out;
}

/** Titles shorter than this are skipped for unlinked mentions — "AI" would match half the vault. */
export const MIN_MENTION_TITLE = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Notes that say `target.title` in prose without linking it. Occurrences already inside [[...]] are
 * excluded — those are linked mentions and would otherwise be double-counted.
 *
 * Deliberately conservative: whole-word match only, and titles under MIN_MENTION_TITLE characters are
 * skipped entirely. A suggestion that fires constantly is worse than one that never fires.
 */
export function findUnlinkedMentions(target: Note, notes: readonly Note[]): Mention[] {
  const title = target.title.trim();
  if (title.length < MIN_MENTION_TITLE) return [];

  // \b is wrong for titles ending in punctuation, so bound on non-word characters explicitly.
  const re = new RegExp(`(?<![\\w-])${escapeRe(title)}(?![\\w-])`, "gi");
  const out: Mention[] = [];

  for (const source of notes) {
    if (source.id === target.id) continue;

    // Mask every [[...]] span so a linked mention can't also count as an unlinked one. Replace with
    // same-length filler to keep offsets aligned with the original content.
    let masked = source.content;
    for (const { start, end } of findWikiLinks(source.content)) {
      masked = masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
    }

    const contexts: string[] = [];
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      contexts.push(contextAt(source.content, m.index, m[0].length));
    }
    re.lastIndex = 0;
    if (contexts.length) out.push({ note: source, contexts });
  }
  return out;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

/**
 * The partial title being typed inside an unclosed `[[`, or null when the caret isn't in one.
 * `before` is the document text up to the caret (callers pass a bounded slice).
 *
 * Lives here rather than in the editor so the matching rule is testable without a CodeMirror instance —
 * it is the part most likely to be subtly wrong.
 */
export function wikiLinkPrefix(before: string): string | null {
  // No "]", "[" or newline between the "[[" and the caret: a completed [[link]], a fresh "[[", or a
  // line break all end the candidate.
  const m = /\[\[([^\][\n]*)$/.exec(before);
  return m ? m[1] : null;
}

// ── Outline ───────────────────────────────────────────────────────────────────

export interface OutlineItem {
  /** 1–6, from the number of leading "#". */
  level: number;
  text: string;
  /** 0-based line index, so clicking can scroll the editor to it. */
  line: number;
}

/**
 * The heading tree of a note, in document order. Fenced code blocks are skipped — a "# comment" inside
 * a shell snippet is not a heading, and treating it as one puts junk in the outline.
 */
export function extractOutline(content: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let fence: string | null = null;

  content.split(/\r?\n/).forEach((raw, line) => {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fenceMatch) {
      // A fence closes only with the same character, and at least as many of them.
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;

    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) out.push({ level: h[1].length, text: h[2].trim(), line });
  });

  return out;
}

// ── Vault graph ────────────────────────────────────────────────────────────────
// Folders are hub nodes; each note hangs off its folder (folders off their parent);
// [[wikilinks]] add note<->note edges; #tags add a distinct tag-hub node per tag with
// note->tag edges. Tags connect the graph without ever being notes. The graph mirrors
// the tree, so it is never just disconnected dots.

export type GraphNodeKind = "note" | "folder" | "tag";

export interface GraphNode {
  id: string;
  title: string;
  degree: number;
  kind: GraphNodeKind;
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  adjacency: Map<string, Set<string>>;
}

export const folderNodeId = (id: string) => `folder:${id}`;
export const tagNodeId = (tag: string) => `tag:${tag}`;

export function buildVaultGraph(notes: readonly Note[], folders: readonly NotebookFolder[]): VaultGraph {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    links.push({ source: a, target: b });
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };

  const folderIds = new Set(folders.map((f) => f.id));
  for (const f of folders) nodes.push({ id: folderNodeId(f.id), title: f.name, degree: 0, kind: "folder" });
  for (const f of folders) if (f.parent_id && folderIds.has(f.parent_id)) link(folderNodeId(f.id), folderNodeId(f.parent_id));

  for (const n of notes) {
    nodes.push({ id: n.id, title: n.title, degree: 0, kind: "note" });
    if (n.folder_id && folderIds.has(n.folder_id)) link(n.id, folderNodeId(n.folder_id));
  }

  // Tag hub nodes (note-free): one per distinct tag, note->tag edge per occurrence.
  const tagNodes = new Set<string>();
  for (const n of notes) {
    for (const tag of extractTags(n.content)) {
      const id = tagNodeId(tag);
      if (!tagNodes.has(id)) {
        tagNodes.add(id);
        nodes.push({ id, title: `#${tag}`, degree: 0, kind: "tag" });
      }
      link(n.id, id);
    }
  }

  // [[wikilink]] note<->note edges (resolved case-insensitively; self-links ignored).
  const titleToId = new Map(notes.map((n) => [linkKey(n.title), n.id]));
  for (const note of notes) {
    for (const { title } of findWikiLinks(note.content)) {
      const targetId = titleToId.get(linkKey(title));
      if (targetId && targetId !== note.id) link(note.id, targetId);
    }
  }

  for (const nd of nodes) nd.degree = degree.get(nd.id) ?? 0;
  return { nodes, links, adjacency };
}
