import { describe, it, expect } from "vitest";
import { evaluatePermission } from "./evaluate";
import { DEFAULT_PERMISSION_RULES, PERMISSION_ROWS, AUTOMATIC_USE_NOTES, PERMISSION_TOOL_LABELS } from "./rules";
import permissionsScreen from "../../views/settings/sections/Permissions.tsx?raw";

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

// The grounding stage and the post-turn reflection use three rows' tools on their own. Deny stops them
// (kernel/ground-permissions.test.ts, knowledge-permission.test.ts); Ask cannot, so the row says so.
describe("rows the tutor also uses on its own say what Ask and Deny do there", () => {
  it("notes exactly the notebook search, the library search and the knowledge map, all shown rows", () => {
    expect(Object.keys(AUTOMATIC_USE_NOTES).sort()).toEqual(["knowledge.update_map", "library.search", "notebook.search"]);
    for (const tool of Object.keys(AUTOMATIC_USE_NOTES)) {
      expect(PERMISSION_ROWS, tool).toContain(tool);
      expect(AUTOMATIC_USE_NOTES[tool], tool).toMatch(/Allow and Ask let that run; only Deny stops it\./);
    }
  });

  it("keeps the defaults", () => {
    expect(DEFAULT_PERMISSION_RULES["notebook.search"].default).toBe("allow");
    expect(DEFAULT_PERMISSION_RULES["library.search"].default).toBe("allow");
    expect(DEFAULT_PERMISSION_RULES["knowledge.update_map"].default).toBe("ask");
  });

  it("is drawn under the row in Settings › Tutor Permissions", () => {
    expect(permissionsScreen).toContain("{AUTOMATIC_USE_NOTES[tool] && (");
  });
});

// Port of TerraTutor #243 (its click test, 2026-11-19): the grid showed "flashcard.create" with no label.
describe("the Permissions grid names every row in plain English", () => {
  it("gives every row it shows a label, and the screen shows it", () => {
    for (const tool of PERMISSION_ROWS) expect(PERMISSION_TOOL_LABELS[tool], tool).toMatch(/^[A-Z][a-z ]+$/);
    expect(PERMISSION_TOOL_LABELS["flashcard.create"]).toBe("Make a flashcard");
    expect(permissionsScreen).toContain("{PERMISSION_ROWS.map((tool) => (");
    expect(permissionsScreen).toContain("{PERMISSION_TOOL_LABELS[tool] ?? tool}");
  });
});
