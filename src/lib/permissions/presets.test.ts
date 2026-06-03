import { describe, it, expect } from "vitest";
import { PERMISSION_PRESETS, detectPreset } from "./presets";
import { DEFAULT_PERMISSION_RULES, PERMISSION_ROWS, type PermissionRules } from "./rules";

const byId = (id: string) => PERMISSION_PRESETS.find((p) => p.id === id)!.rules;

describe("permission presets", () => {
  it("Standard equals the built-in defaults", () => {
    expect(byId("standard")).toEqual(DEFAULT_PERMISSION_RULES);
  });

  it("EVERY preset preserves the exam column (integrity invariant — presets never loosen exams)", () => {
    for (const preset of PERMISSION_PRESETS) {
      for (const tool of PERMISSION_ROWS) {
        expect(preset.rules[tool].exam).toBe(DEFAULT_PERMISSION_RULES[tool].exam);
      }
    }
  });

  it("detectPreset round-trips each named preset", () => {
    for (const preset of PERMISSION_PRESETS) {
      expect(detectPreset(preset.rules)).toBe(preset.id);
    }
  });

  it("detectPreset returns 'custom' for a hand-tuned grid", () => {
    const custom: PermissionRules = {
      ...DEFAULT_PERMISSION_RULES,
      "code.run": { ...DEFAULT_PERMISSION_RULES["code.run"], default: "deny" },
    };
    expect(detectPreset(custom)).toBe("custom");
  });

  it("Cautious asks before network / code / ingest / record-writes in default + study", () => {
    const cautious = byId("cautious");
    for (const tool of ["web.search", "web.fetch", "code.run", "notebook.ingest", "knowledge.update_map", "progress.mark_mastered"]) {
      expect(cautious[tool].default).toBe("ask");
      expect(cautious[tool].study).toBe("ask");
    }
  });

  it("Trusting allows in default + study but keeps the exam lock", () => {
    const trusting = byId("trusting");
    expect(trusting["web.search"].default).toBe("allow");
    expect(trusting["web.search"].study).toBe("allow");
    expect(trusting["web.search"].exam).toBe(DEFAULT_PERMISSION_RULES["web.search"].exam); // still deny
  });
});
