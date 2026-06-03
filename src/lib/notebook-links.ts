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
// A [[wiki link]] is any run of non-"]" characters between double brackets.
export const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;
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
