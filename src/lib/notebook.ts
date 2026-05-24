// Notebook RAG layer (Phase 3, V2_ARCHITECTURE.md §6.3).
//
// Pure-ish lib functions that the notebook.* EduTools and the NotebookTab UI both call:
//   - ingestDocument: chunk → embed → store (sha256-deduped, idempotent)
//   - searchNotebook:  embed the query → brute-force cosine over the course's chunk vectors → top-k
//
// Vectors are stored as JSON-array TEXT (see db.ts / migration v7). Brute-force cosine is fine for a
// single student's notebook (hundreds–low-thousands of chunks, sub-100ms); sqlite-vec is deferred
// (it can't load cleanly through tauri-plugin-sql's sqlx pool — see the Phase 3 plan). The schema
// stays vec0-compatible if that ever changes.

import { embed } from "./llm";
import { getEmbeddingConfig } from "./store";
import {
  findNotebookDocumentBySha,
  createNotebookDocument,
  createNotebookChunk,
  getNotebookDocuments,
  loadNotebookVectors,
} from "./db";
import type { NotebookSearchResult, NotebookSourceType } from "../types";

// ── Text utilities ───────────────────────────────────────────────────────────

// Cheap token estimate — ~4 chars/token. Good enough for chunk sizing; we never bill on it.
const estTokens = (s: string) => Math.ceil(s.length / 4);

// Split text into ~maxTokens chunks on sentence/paragraph boundaries. A single oversized sentence
// is hard-split so no chunk blows the embedder's context.
export function chunkText(text: string, maxTokens = 512): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const sentences = clean
    .split(/\n{2,}/) // paragraphs first
    .flatMap((p) => p.split(/(?<=[.!?])\s+/)) // then sentences within a paragraph
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && estTokens(cur) + estTokens(s) > maxTokens) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (estTokens(s) > maxTokens) {
      if (cur) { chunks.push(cur.trim()); cur = ""; }
      const span = maxTokens * 4;
      for (let i = 0; i < s.length; i += span) chunks.push(s.slice(i, i + span));
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// Cosine similarity of two equal-length vectors (returns 0 when either is degenerate).
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Ingestion ────────────────────────────────────────────────────────────────

export interface IngestResult {
  documentId: string;
  chunkCount: number;
  deduped: boolean; // true = identical content already ingested; we returned the existing doc
}

// Chunk + embed + persist a document. Idempotent: identical content (same sha256) in the same
// course returns the existing document instead of re-embedding.
export async function ingestDocument(args: {
  courseId: string;
  title: string;
  sourceType: NotebookSourceType;
  text: string;
  sourceUri?: string | null;
}): Promise<IngestResult> {
  const sha = await sha256Hex(args.text);
  const existing = await findNotebookDocumentBySha(args.courseId, sha);
  if (existing) {
    const docs = await getNotebookDocuments(args.courseId);
    const found = docs.find((d) => d.id === existing.id);
    return { documentId: existing.id, chunkCount: found?.chunk_count ?? 0, deduped: true };
  }

  const chunks = chunkText(args.text);
  if (chunks.length === 0) throw new Error("Nothing to ingest — the document is empty.");

  const cfg = await getEmbeddingConfig();
  const vectors = await embed(chunks, cfg);
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedding count mismatch: ${vectors.length} vectors for ${chunks.length} chunks.`);
  }
  const dim = vectors[0]?.length ?? 0;

  const documentId = await createNotebookDocument({
    courseId: args.courseId,
    title: args.title,
    sourceType: args.sourceType,
    sourceUri: args.sourceUri ?? null,
    sha256: sha,
    embeddingModel: cfg.model,
    dim,
  });

  for (let i = 0; i < chunks.length; i++) {
    await createNotebookChunk({
      documentId,
      ord: i,
      text: chunks[i],
      tokenCount: estTokens(chunks[i]),
      vec: JSON.stringify(vectors[i]),
    });
  }

  return { documentId, chunkCount: chunks.length, deduped: false };
}

// ── Retrieval ────────────────────────────────────────────────────────────────

// Embed the query and rank the course's chunks by cosine similarity. Only compares chunks embedded
// with the current model (loadNotebookVectors filters by model), so dimensions always match.
export async function searchNotebook(args: {
  courseId: string;
  query: string;
  topK?: number;
}): Promise<NotebookSearchResult[]> {
  const topK = args.topK ?? 5;
  const q = args.query.trim();
  if (!q) return [];

  const cfg = await getEmbeddingConfig();
  const [qvec] = await embed([q], cfg);
  if (!qvec) return [];

  const rows = await loadNotebookVectors(args.courseId, cfg.model);
  const scored: NotebookSearchResult[] = [];
  for (const row of rows) {
    let vec: number[];
    try {
      vec = JSON.parse(row.vec);
    } catch {
      continue; // skip a corrupt row rather than fail the whole search
    }
    scored.push({
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      document_title: row.document_title,
      ord: row.ord,
      text: row.text,
      score: cosineSim(qvec, vec),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
