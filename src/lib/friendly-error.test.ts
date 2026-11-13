import { describe, it, expect } from "vitest";
import {
  describeToolActivity, describeToolCall, describeToolDone,
  friendlyDownloadError, friendlyError, preflightMessage, tutorStatusLabel,
} from "./plain-language";

describe("tool chips", () => {
  const TOOLS = ["notebook.search", "notebook.ingest", "library.search", "library.lookup", "web.search", "flashcard.create",
    "flashcard.review_due", "progress.read", "progress.mark_mastered", "knowledge.read", "knowledge.update_map", "code.run", "widget.spin"];

  it("never shows a tool id while running or when done", () => {
    for (const t of TOOLS) {
      for (const out of [describeToolActivity(t), describeToolDone(t)]) {
        expect(out).not.toContain(t);
        expect(out).not.toMatch(/\w[._]\w/);
      }
    }
  });

  it("says what is happening in words", () => {
    expect(describeToolActivity("notebook.search")).toBe("Looking through your notes…");
    expect(describeToolDone("progress.read")).toBe("Checked your progress");
  });
});

describe("describeToolCall", () => {
  it("shows the card the tutor will make, from the call's own arguments", () => {
    expect(describeToolCall("flashcard.create", { front: "What is 7 x 8?", back: "56" })).toBe("The card: “What is 7 x 8?”");
    expect(describeToolCall("notebook.ingest", { title: "Fractions", text: "..." })).toBe("The note: “Fractions”");
  });

  it("is empty when the arguments hold nothing a learner would recognise", () => {
    expect(describeToolCall("knowledge.update_map", { note: "x" })).toBe("");
    expect(describeToolCall("flashcard.create", undefined)).toBe("");
  });

  it("clips a long card", () => {
    expect(describeToolCall("flashcard.create", { front: "a".repeat(300) })).toHaveLength("The card: “”".length + 121);
  });
});

describe("friendlyError", () => {
  const ENGINEERING = /JSON|schema|done_reason|ollama pull|ollama serve|tier=|LLM|attempts|Issues:|chars|\d+s\b|undefined|TypeError/i;

  // The messages llm.ts and the course builder throw that the audit found on screen.
  const RAW = [
    'Structured output failed after 3 attempts. Issues: response did not contain valid JSON. Last response (first 200 chars): "Sure!"',
    "LLM call timed out after 180s (tier=tiny). The model may be too slow or hung; try a smaller model or check your Ollama server.",
    'Ollama model "gemma4:e2b" hit its context limit before emitting an answer (done_reason=length). Raise the context window',
    'Ollama model "gemma4:e2b" not found — run: ollama pull gemma4:e2b',
    'Ollama embedding model "nomic-embed-text" not found — run: ollama pull nomic-embed-text',
    "Ollama error 500: llama runner process has terminated: exit status 2",
    'Two or more subtopic expansions failed in Level 3 — aborting. Most recent: "Fractions". Reason: Structured output failed after 3 attempts.',
    "Course outline missing a plan for Level 4. Outline contains: [1, 2, 3]. Re-run course generation — outline gen produced an incomplete plan.",
    "Could not generate quiz questions — the model returned no valid questions. Try again, or switch to a more capable model.",
    "TypeError: Cannot read properties of undefined (reading 'map')",
  ];

  it("never shows engineering text", () => {
    for (const raw of RAW) {
      const out = friendlyError(new Error(raw));
      expect(out, raw).not.toMatch(ENGINEERING);
      expect(out, raw).toMatch(/\.$/);
    }
  });

  it("gives a next step for each known failure", () => {
    expect(friendlyError(new Error(RAW[1]))).toMatch(/took too long.*Try again/);
    expect(friendlyError(new Error(RAW[2]))).toMatch(/too much .* at once/);
    expect(friendlyError(new Error(RAW[3]))).toBe("The tutor's model (gemma4:e2b) isn't on this computer yet. Open Settings to pick one that is, or import it from a USB stick.");
    expect(friendlyError(new Error(RAW[4]))).toMatch(/^Notebook search isn't set up/);
    expect(friendlyError(new Error(RAW[5]))).toMatch(/close Ollama and start it again/);
  });

  it("keeps the sentences llm.ts already writes for people, even when the course builder wraps them", () => {
    const down = "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.";
    expect(friendlyError(new Error(down))).toBe(down);
    expect(friendlyError(new Error(`Two or more subtopic expansions failed in Level 2 — aborting. Most recent: "x". Reason: ${down}`))).toBe(down);
    const remote = "Ollama isn't answering at http://192.168.1.20:11434. Check that the computer running it is on and Ollama is started.";
    expect(friendlyError(remote)).toBe(remote);
    const offline = "Network error — check your internet connection and try again.";
    expect(friendlyError(new Error(offline))).toBe(offline);
    const key = "Invalid API key (OpenAI). Double-check the key in Settings — it may be expired or incorrect.";
    expect(friendlyError(new Error(key))).toBe(key);
  });

  it("falls back to a plain sentence for anything unknown", () => {
    expect(friendlyError(new Error("ECONNRESET 0x80004005"))).toBe("Something went wrong. Try again in a moment.");
    expect(friendlyError(undefined)).toBe("Something went wrong. Try again in a moment.");
  });
});

describe("model advice after a failed build", () => {
  const FAIL = "Structured output failed after 2 attempts. Issues: response did not contain valid JSON.";
  const GB = 1024 ** 3;

  it("never suggests gemma4:e4b on an 8 GB computer", () => {
    expect(friendlyError(FAIL, { model: "gemma4:e2b", provider: "ollama", ramBytes: 8 * GB })).not.toMatch(/e4b/);
    // A computer running something else is pointed at the model that fits it.
    expect(friendlyError(FAIL, { model: "qwen3.5:0.8b", provider: "ollama", ramBytes: 8 * GB })).toMatch(/switch the tutor to gemma4:e2b/);
    expect(friendlyError(FAIL, { model: "gemma4:e4b", provider: "ollama", ramBytes: 8 * GB })).toMatch(/switch the tutor to gemma4:e2b/);
  });

  it("suggests gemma4:e4b only where it fits", () => {
    expect(friendlyError(FAIL, { model: "gemma4:e2b", provider: "ollama", ramBytes: 32 * GB })).toMatch(/switch the tutor to gemma4:e4b/);
  });

  it("gives no model advice for a cloud tutor or when the computer's memory is unknown", () => {
    expect(friendlyError(FAIL, { model: "gpt-5-mini", provider: "openai", ramBytes: 8 * GB })).toBe("The tutor couldn't put this together this time. Try again.");
    expect(friendlyError(FAIL, { model: "gemma4:e2b", provider: "ollama" })).toBe("The tutor couldn't put this together this time. Try again.");
  });

  it("never mentions models when the check timed out", () => {
    expect(preflightMessage(true, "Model did not respond within 90s.", { model: "gemma4:e2b", ramBytes: 8 * GB })).toBe(
      "The tutor took too long to wake up. Try again — it is usually quicker the second time.",
    );
  });
});

describe("friendlyDownloadError", () => {
  it("says a download needs the internet instead of Ollama's registry text", () => {
    const raw = 'pull model manifest: Get "https://registry.ollama.ai/v2/library/gemma4/manifests/e2b": dial tcp: lookup registry.ollama.ai: no such host';
    expect(friendlyDownloadError(new Error(raw))).toBe(
      "Downloading the model needs the internet, and this computer isn't connected. Connect and try again, or import the model from a USB stick.",
    );
  });

  it("keeps the Ollama-not-running sentence", () => {
    const down = "Ollama, the program that runs the tutor, isn't running on this computer. Start Ollama, then try again.";
    expect(friendlyDownloadError(new Error(down))).toBe(down);
  });

  it("never shows the raw text for anything else", () => {
    expect(friendlyDownloadError(new Error("unexpected EOF"))).toBe("The download didn't finish. Try again, or import the model from a USB stick.");
  });
});

describe("tutorStatusLabel", () => {
  it("claims nothing for a local tutor that is ready or not checked yet", () => {
    expect(tutorStatusLabel("ollama", "ready")).toBeNull();
    expect(tutorStatusLabel("ollama", undefined)).toBeNull();
  });

  it("says plainly when the local tutor is not running or has no model", () => {
    expect(tutorStatusLabel("ollama", "not-running")).toEqual({ text: "Tutor not running", tone: "warn" });
    expect(tutorStatusLabel("ollama", "not-installed")).toEqual({ text: "Tutor not running", tone: "warn" });
    expect(tutorStatusLabel("ollama", "no-model")).toEqual({ text: "Tutor model missing", tone: "warn" });
  });

  it("names a cloud provider, so a parent can see questions leave this computer", () => {
    expect(tutorStatusLabel("openai", undefined)).toEqual({ text: "OpenAI", tone: "info" });
  });
});
