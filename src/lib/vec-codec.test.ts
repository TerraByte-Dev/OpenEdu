import { describe, it, expect } from "vitest";
import { encodeVec, decodeVec, readVec, cosine } from "./vec-codec";

const rand = (n: number) => Array.from({ length: n }, () => Math.random() * 2 - 1);

describe("vector encoding", () => {
  it("round-trips f32 exactly", () => {
    const v = rand(768);
    const back = decodeVec(encodeVec(v))!;
    expect(back.length).toBe(768);
    // f32 round-trip is exact through the buffer; only the initial float64 -> float32 narrowing
    // loses anything, and Float32Array.from does that identically on both sides.
    expect(Array.from(back)).toEqual(Array.from(Float32Array.from(v)));
  });

  it("is materially smaller than the JSON encoding it replaces", () => {
    const v = rand(768);
    const json = JSON.stringify(v).length;
    const b64 = encodeVec(v).length;
    // Measured on the real corpus: 9,495 bytes as JSON against 3,072 raw. Base64 is 4/3 of raw.
    expect(b64).toBe(4096);
    expect(json).toBeGreaterThan(8000);
    expect(b64).toBeLessThan(json / 2);
  });

  it("handles a vector large enough to break a naive spread", () => {
    // String.fromCharCode(...bytes) on a 4096-dim vector is 16,384 arguments — past the argument
    // limit on some engines. encodeVec chunks instead, so this must not throw.
    const v = rand(4096);
    expect(decodeVec(encodeVec(v))!.length).toBe(4096);
  });

  it("returns null on malformed input rather than throwing", () => {
    expect(decodeVec("not base64 @@@")).toBeNull();
    expect(decodeVec(btoa("abc"))).toBeNull(); // 3 bytes: not a whole number of f32
  });
});

describe("readVec — both encodings stay live", () => {
  it("prefers base64", () => {
    const v = Float32Array.from([1, 2, 3, 4]);
    const got = readVec({ vec_b64: encodeVec(v), vec: "[9,9,9,9]" })!;
    expect(Array.from(got)).toEqual([1, 2, 3, 4]);
  });

  it("falls back to legacy JSON, so an upgrade needs no re-embedding", () => {
    // Migration 12 adds the column and backfills nothing — rows written before it hold JSON in
    // `vec` and NULL in `vec_b64`, and must keep working until a re-index rewrites them.
    const got = readVec({ vec_b64: null, vec: "[1,2,3]" })!;
    expect(Array.from(got)).toEqual([1, 2, 3]);
  });

  it("returns null when a row carries neither", () => {
    expect(readVec({ vec_b64: null, vec: null })).toBeNull();
    expect(readVec({ vec_b64: "", vec: "" })).toBeNull();
  });
});

describe("cosine", () => {
  it("is 1 for identical and 0 for orthogonal", () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosine(a, Float32Array.from([2, 0, 0]))).toBeCloseTo(1, 6);
    expect(cosine(a, Float32Array.from([0, 1, 0]))).toBeCloseTo(0, 6);
  });

  it("never divides by zero on a zero vector", () => {
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});
