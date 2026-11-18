import { describe, it, expect } from "vitest";
import { ingestResultSummary } from "./ingest-format";

describe("ingestResultSummary", () => {
  it("is silent (ok, no message) when everything embedded cleanly", () => {
    expect(ingestResultSummary({ imported: 3, pending: 0, failed: 0 })).toEqual({ kind: "ok", message: null });
  });

  it("with Ollama not running says the notes are searched by their words for now", () => {
    const s = ingestResultSummary({ imported: 3, pending: 3, failed: 0, reason: "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again." });
    expect(s.kind).toBe("warn");
    expect(s.message).toBe("Imported 3 notes. They're searched by their words for now. OpenEdu tries again each time you open Notes.");
    expect(ingestResultSummary({ imported: 1, pending: 1, failed: 0, reason: "OpenAI API key not set — add it in Settings to use OpenAI embeddings." }).message)
      .toBe("Imported 1 note. It's searched by its words for now. OpenEdu tries again each time you open Notes.");
  });

  it("with no embedding model says the notes are searched by their words, and where searching by meaning is added", () => {
    const s = ingestResultSummary({
      imported: 2, pending: 2, failed: 0,
      reason: 'Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text',
    });
    expect(s.message).toBe(
      "Imported 2 notes. They're searched by their words; searching by meaning needs the embedding model, " +
      "added in Settings › Provider & Models.",
    );
  });

  it("warns, and says it will try again, when a note's own embed failed", () => {
    const s = ingestResultSummary({ imported: 3, pending: 1, failed: 0, reason: "Ollama embed error 500: unexpected input" });
    expect(s.kind).toBe("warn");
    expect(s.message).toBe(
      "Imported 3 notes, but 1 note couldn't be added to notebook search yet. OpenEdu tries again each time you open Notes.",
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
