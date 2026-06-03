import { describe, it, expect } from "vitest";
import {
  parseSettingsExport, sanitizeImportedPermissions, isKnownThemeId, EXPORT_KIND, EXPORT_VERSION,
} from "./settings-schema";
import { DEFAULT_PERMISSION_RULES, PERMISSION_ROWS } from "./permissions/rules";

const validFile = JSON.stringify({
  kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt: "2026-06-02T00:00:00.000Z",
  theme: "amber", crtOff: false, settings: { llm_provider: "ollama" }, permissions: {},
});

describe("parseSettingsExport", () => {
  it("parses a valid file", () => {
    const p = parseSettingsExport(validFile);
    expect(p.kind).toBe(EXPORT_KIND);
    expect(p.settings.llm_provider).toBe("ollama");
  });
  it("rejects invalid JSON", () => {
    expect(() => parseSettingsExport("{not json")).toThrow(/valid JSON/);
  });
  it("rejects a non-OpenEdu file", () => {
    expect(() => parseSettingsExport(JSON.stringify({ kind: "something-else" }))).toThrow(/Not an OpenEdu/);
  });
  it("rejects a missing/invalid settings block", () => {
    expect(() => parseSettingsExport(JSON.stringify({ kind: EXPORT_KIND }))).toThrow(/settings block/);
    expect(() => parseSettingsExport(JSON.stringify({ kind: EXPORT_KIND, settings: [] }))).toThrow(/settings block/);
  });
});

describe("isKnownThemeId", () => {
  it("accepts known theme ids and rejects everything else", () => {
    expect(isKnownThemeId("amber")).toBe(true);
    expect(isKnownThemeId("openedu")).toBe(true);
    expect(isKnownThemeId("solarized")).toBe(false);
    expect(isKnownThemeId(undefined)).toBe(false);
    expect(isKnownThemeId(42)).toBe(false);
  });
});

describe("sanitizeImportedPermissions", () => {
  it("returns null for non-objects", () => {
    expect(sanitizeImportedPermissions(null)).toBeNull();
    expect(sanitizeImportedPermissions("x")).toBeNull();
    expect(sanitizeImportedPermissions([])).toBeNull();
  });

  it("drops unknown tools, rejects garbage decisions, keeps valid overrides, fills from defaults", () => {
    const out = sanitizeImportedPermissions({
      "web.fetch": { default: "yolo", study: "deny" },
      "evil.tool": { default: "allow" },
    })!;
    expect(out["evil.tool"]).toBeUndefined();                                  // unknown tool dropped
    expect(out["web.fetch"].default).toBe(DEFAULT_PERMISSION_RULES["web.fetch"].default); // "yolo" → default
    expect(out["web.fetch"].study).toBe("deny");                               // valid override kept
    expect(out["web.fetch"].exam).toBe(DEFAULT_PERMISSION_RULES["web.fetch"].exam);
    for (const tool of PERMISSION_ROWS) expect(out[tool]).toBeDefined();       // result is complete
  });

  it("preserves a fully-valid rules object", () => {
    expect(sanitizeImportedPermissions(DEFAULT_PERMISSION_RULES)).toEqual(DEFAULT_PERMISSION_RULES);
  });
});
