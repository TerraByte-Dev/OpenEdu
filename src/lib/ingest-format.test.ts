import { describe, it, expect } from "vitest";
import { ingestResultSummary } from "./ingest-format";

describe("ingestResultSummary", () => {
  it("is silent (ok, no message) when everything embedded cleanly", () => {
    expect(ingestResultSummary({ imported: 3, pending: 0, failed: 0 })).toEqual({ kind: "ok", message: null });
  });

  it("warns (not errors) when notes import but can't be embedded — the embedder-offline case", () => {
    const s = ingestResultSummary({ imported: 3, pending: 3, failed: 0 });
    expect(s.kind).toBe("warn");
    expect(s.message).toMatch(/couldn't be embedded/i);
    expect(s.message).toMatch(/Ollama/);
    expect(s.message).toMatch(/re-index/i);
  });

  it("errors only when nothing imported at all", () => {
    const s = ingestResultSummary({ imported: 0, pending: 0, failed: 2 });
    expect(s.kind).toBe("error");
    expect(s.message).toMatch(/Couldn't import 2 files/);
  });

  it("pluralizes singular counts", () => {
    expect(ingestResultSummary({ imported: 0, pending: 0, failed: 1 }).message).toMatch(/1 file\b/);
    expect(ingestResultSummary({ imported: 1, pending: 1, failed: 0 }).message).toMatch(/1 note\b/);
  });

  it("reports partial hard-failures while still confirming the imports", () => {
    const s = ingestResultSummary({ imported: 2, pending: 0, failed: 1 });
    expect(s.kind).toBe("warn");
    expect(s.message).toMatch(/Imported 2 notes/);
    expect(s.message).toMatch(/skipped 1/);
  });
});
