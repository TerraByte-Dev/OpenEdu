import { describe, it, expect } from "vitest";
import { ingestResultSummary } from "./ingest-format";

describe("ingestResultSummary", () => {
  it("is silent (ok, no message) when everything embedded cleanly", () => {
    expect(ingestResultSummary({ imported: 3, pending: 0, failed: 0 })).toEqual({ kind: "ok", message: null });
  });

  it("warns (not errors) when notes import but can't be embedded — the embedder-offline case", () => {
    const s = ingestResultSummary({ imported: 3, pending: 3, failed: 0, reason: "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again." });
    expect(s.kind).toBe("warn");
    expect(s.message).toBe(
      "Imported 3 notes, but 3 notes couldn't be added to notebook search yet. OpenEdu tries again each time you open Notes.",
    );
  });

  it("names the missing embedding model's fix, and never promises an open-and-save that does nothing", () => {
    const s = ingestResultSummary({
      imported: 2, pending: 2, failed: 0,
      reason: 'Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text',
    });
    expect(s.message).toBe(
      "Imported 2 notes, but 2 notes couldn't be added to notebook search yet. Notebook search isn't set up on " +
      "this computer yet. Add the embedding model in Settings › Provider & Models. OpenEdu tries again each " +
      "time you open Notes.",
    );
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
