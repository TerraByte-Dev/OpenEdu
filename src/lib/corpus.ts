// Read-only access to a folder the user picked. The TS half of src-tauri/src/corpus.rs.
//
// Until now the app could not read a file at all — no fs plugin, no dialog, zero Tauri commands.
// Everything here goes through explicit grants: the user picks a folder, the Rust side canonicalises
// it, and every later read must prove it lives under one of those roots. There is no write path.

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface CorpusEntry {
  path: string;
  name: string;
  /** Lowercased, no dot. Empty when the file has none. */
  ext: string;
  bytes: number;
}

export interface CorpusListing {
  root: string;
  entries: CorpusEntry[];
  /** The walk hit its cap. SHOW THIS — a silently truncated listing reads as "this is everything". */
  truncated: boolean;
  /** Unreadable directories, reported rather than fatal. One bad folder must not abort a walk. */
  skipped: string[];
}

/** Formats we can turn into text today. Anything else needs an extractor that does not exist yet. */
export const READABLE_EXTS = ["md", "markdown", "txt", "csv", "json", "srt", "vtt"];

/** Open the OS folder picker. Returns null if the user cancelled. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: "Choose a folder to study from" });
  return typeof picked === "string" ? picked : null;
}

/** Trust a folder for this session. Returns the canonical path the backend recorded. */
export function grantFolder(path: string): Promise<string> {
  return invoke<string>("corpus_grant", { path });
}

export function grantedFolders(): Promise<string[]> {
  return invoke<string[]>("corpus_granted");
}

/**
 * Walk a granted root, breadth-first, capped.
 *
 * Breadth-first because an archive's useful files cluster near the top, so a truncated walk still
 * returns something representative. Pass `exts: []` for everything.
 */
export function listCorpus(
  root: string,
  opts: { max?: number; exts?: string[] } = {},
): Promise<CorpusListing> {
  return invoke<CorpusListing>("corpus_list", {
    root,
    max: opts.max ?? 5000,
    exts: opts.exts ?? READABLE_EXTS,
  });
}

/** Read one file under a granted root. Capped — an archive contains files that would take the process down. */
export function readCorpusText(path: string, maxBytes = 4 * 1024 * 1024): Promise<string> {
  return invoke<string>("corpus_read_text", { path, maxBytes });
}

/** One spine item of an EPUB, as text. */
export interface EpubSection {
  /** First h1-h3, else the page's <title>, else `href`. */
  title: string;
  /** The chapter's path inside the archive. */
  href: string;
  text: string;
}

/**
 * Extract an EPUB under a granted root into text sections, in reading (spine) order. Sections, not
 * one blob, so a small model can be handed one at a time. `maxBytes` caps the compressed file; the
 * backend separately caps what it inflates to, so a zip bomb is an error rather than a crash.
 */
export function extractEpub(path: string, maxBytes = 64 * 1024 * 1024): Promise<EpubSection[]> {
  return invoke<EpubSection[]>("corpus_extract_epub", { path, maxBytes });
}

/** Pick, grant and list in one step — the whole "point it at a folder" gesture. */
export async function openFolder(opts?: { max?: number; exts?: string[] }): Promise<CorpusListing | null> {
  const picked = await pickFolder();
  if (!picked) return null;
  const root = await grantFolder(picked);
  return listCorpus(root, opts);
}
