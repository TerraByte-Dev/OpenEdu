import { describe, it, expect } from "vitest";
import { evaluatePermission } from "./evaluate";
import { DEFAULT_PERMISSION_RULES } from "./rules";

// Slice A4 — exam-mode integrity guard.
//
// Promotion tests are enforced *structurally*: PromotionTestFullScreen is a full-screen modal with no
// kernel/tutor surface, so the student literally cannot ask the tutor for help during a test. The
// `exam`-mode permission rules are the second line of defense — they ensure that IF a tutor turn ever
// runs in exam mode (e.g. a future in-test hint affordance), the model-help tools are denied. This
// test locks that invariant so the policy can't silently rot as new tools are added.

const tool = (name: string, isReadOnly = false) => ({ name, isReadOnly });

describe("exam-mode permission integrity", () => {
  it("denies the model-help tools during an exam", () => {
    for (const name of ["quiz.generate", "math.render", "diagram.render", "web.search", "web.fetch", "notebook.ingest", "flashcard.create"]) {
      expect(evaluatePermission(tool(name), "exam", DEFAULT_PERMISSION_RULES)).toBe("deny");
    }
  });

  it("still allows passive reads during an exam", () => {
    for (const name of ["notebook.search", "knowledge.read", "progress.read"]) {
      expect(evaluatePermission(tool(name, true), "exam", DEFAULT_PERMISSION_RULES)).toBe("allow");
    }
  });

  it("treats curated-reference lookups as a conscious 'ask' during an exam", () => {
    expect(evaluatePermission(tool("library.search", true), "exam", DEFAULT_PERMISSION_RULES)).toBe("ask");
    expect(evaluatePermission(tool("library.lookup", true), "exam", DEFAULT_PERMISSION_RULES)).toBe("ask");
  });

  it("bypass mode overrides everything (escape hatch)", () => {
    expect(evaluatePermission(tool("math.render"), "bypass", DEFAULT_PERMISSION_RULES)).toBe("allow");
  });

  it("requires an explicit deny rule (an unlisted writer falls back to ask, not deny)", () => {
    // A tool with no rule falls back to the read/write default (writer → "ask"), NOT deny. So model-help
    // tools MUST carry an explicit exam:"deny" rule — which is exactly what the first test guards.
    expect(evaluatePermission(tool("some.unlisted_writer"), "exam", DEFAULT_PERMISSION_RULES)).toBe("ask");
  });
});
