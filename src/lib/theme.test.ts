import { describe, it, expect } from "vitest";
import {
  THEMES, THEME_CHOICES, DEFAULT_THEME_ID, normalizeThemeChoice, isRecognizedThemeId, resolveTheme,
} from "./theme";

describe("theme registry", () => {
  it("has exactly the two Notebook palettes, light first and default", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["light", "dark"]);
    expect(DEFAULT_THEME_ID).toBe("light");
  });

  it("offers Light, Dark and Match my computer", () => {
    expect(THEME_CHOICES.map((c) => c.label)).toEqual(["Light", "Dark", "Match my computer"]);
    expect(THEME_CHOICES.map((c) => c.id)).toEqual(["light", "dark", "system"]);
  });
});

describe("normalizeThemeChoice (stored and imported ids)", () => {
  it("nothing stored, or the old default 'openedu', is light", () => {
    expect(normalizeThemeChoice(null)).toBe("light");
    expect(normalizeThemeChoice(undefined)).toBe("light");
    expect(normalizeThemeChoice("openedu")).toBe("light");
  });

  it("current choices pass through", () => {
    expect(normalizeThemeChoice("light")).toBe("light");
    expect(normalizeThemeChoice("dark")).toBe("dark");
    expect(normalizeThemeChoice("system")).toBe("system");
  });

  it("every CRT recolor maps to dark — those users chose a dark screen", () => {
    for (const id of ["amber", "green", "synthwave", "ice", "tangerine", "crimson", "vapor", "ultraviolet"]) {
      expect(normalizeThemeChoice(id)).toBe("dark");
    }
  });

  it("anything unknown is light", () => {
    expect(normalizeThemeChoice("solarized")).toBe("light");
    expect(normalizeThemeChoice("")).toBe("light");
    expect(normalizeThemeChoice(42)).toBe("light");
    expect(normalizeThemeChoice("Dark")).toBe("light"); // ids are case-sensitive, as they were stored
  });
});

describe("isRecognizedThemeId", () => {
  it("knows every id any OpenEdu version wrote", () => {
    for (const id of ["openedu", "light", "dark", "system", "amber", "ultraviolet"]) {
      expect(isRecognizedThemeId(id)).toBe(true);
    }
  });

  it("rejects garbage", () => {
    expect(isRecognizedThemeId("solarized")).toBe(false);
    expect(isRecognizedThemeId(undefined)).toBe(false);
    expect(isRecognizedThemeId(42)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("explicit choices ignore the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("Match my computer follows prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
