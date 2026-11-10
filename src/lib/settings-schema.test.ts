import { describe, it, expect } from "vitest";
import {
  parseSettingsExport, sanitizeImportedPermissions, importedThemeChoice, EXPORT_KIND, EXPORT_VERSION,
} from "./settings-schema";
import { DEFAULT_PERMISSION_RULES, PERMISSION_ROWS } from "./permissions/rules";

const validFile = JSON.stringify({
  kind: EXPORT_KIND, version: EXPORT_VERSION, exportedAt: "2026-06-02T00:00:00.000Z",
  theme: "light", settings: { llm_provider: "ollama" }, permissions: {},
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

describe("importedThemeChoice", () => {
  it("passes current choices through", () => {
    expect(importedThemeChoice("light")).toBe("light");
    expect(importedThemeChoice("dark")).toBe("dark");
    expect(importedThemeChoice("system")).toBe("system");
  });

  it("maps CRT-era ids: the old default to light, recolors to dark", () => {
    expect(importedThemeChoice("openedu")).toBe("light");
    expect(importedThemeChoice("amber")).toBe("dark");
    expect(importedThemeChoice("synthwave")).toBe("dark");
  });

  it("returns null for a missing or unrecognized theme, so the import leaves the current one alone", () => {
    expect(importedThemeChoice("solarized")).toBeNull();
    expect(importedThemeChoice(undefined)).toBeNull();
    expect(importedThemeChoice(42)).toBeNull();
  });
});

describe("an export written before the Notebook look", () => {
  const oldFile = JSON.stringify({
    kind: EXPORT_KIND, version: 1, exportedAt: "2026-06-02T00:00:00.000Z",
    theme: "synthwave", crtOff: true, settings: { llm_provider: "ollama" }, permissions: {},
  });

  it("still imports: crtOff is accepted, and synthwave lands on dark", () => {
    const p = parseSettingsExport(oldFile);
    expect(p.settings.llm_provider).toBe("ollama");
    expect(p.crtOff).toBe(true); // tolerated, never applied
    expect(importedThemeChoice(p.theme)).toBe("dark");
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
