// Embedding vectors on the wire. Pure, Tauri-free, unit-tested.
//
// They shipped as JSON-array TEXT — `[-0.026990877,-0.073400095,...]` — which measured **9,495
// bytes for a 768-dim f32 against 3,072 raw**, a 3.09x bloat. That multiplier lands three times:
// on disk, on every byte crossing the Tauri IPC boundary, and on `JSON.parse` (43.1 us/vector
// against 1.03 us for the cosine that follows it).
//
// It was also a hard ceiling, not a slope. Retrieval loaded every chunk in a course as one IPC
// payload, and V8 cannot construct a string above 2^29-24 bytes — so the feature stopped working
// entirely somewhere around 47,000 chunks, roughly 2,500 documents.
//
// Base64 of the raw f32 buffer is 4/3 x 3,072 = **4,096 bytes**, a 2.32x reduction, and decodes
// without a parser. Storage is little-endian, which every platform this ships on uses; a
// big-endian host would need a byte swap here and nowhere else.

/** Encode a vector for storage. */
export function encodeVec(vec: number[] | Float32Array): string {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  // Chunked rather than String.fromCharCode(...bytes): a 768-dim vector is 3,072 arguments and a
  // spread that size is at the edge of the argument limit on some engines. This is not.
  let s = "";
  const STEP = 8192;
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(s);
}

/** Decode a stored vector. Returns null on anything malformed rather than throwing. */
export function decodeVec(b64: string): Float32Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.byteLength % 4 !== 0) return null;
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  } catch {
    return null;
  }
}

/**
 * Read whichever encoding a row carries.
 *
 * Existing rows hold JSON in `vec` and NULL in `vec_b64` — migration 12 adds the column but
 * backfills nothing, because a re-index rewrites them anyway and correctness never depended on it.
 * Both paths stay live so an install upgrades without re-embedding its notebook.
 */
export function readVec(row: { vec_b64?: string | null; vec?: string | null }): Float32Array | null {
  if (row.vec_b64) return decodeVec(row.vec_b64);
  if (row.vec) {
    try {
      const arr = JSON.parse(row.vec);
      return Array.isArray(arr) ? Float32Array.from(arr) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Cosine over pre-normalised vectors is a dot product; this does not assume they are. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
