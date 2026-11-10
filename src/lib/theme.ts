// Appearance: the "Notebook" look in two modes, light (the default) and dark, plus "Match my computer",
// which follows the OS `prefers-color-scheme`. The UI is CSS-variable driven (src/index.css): light is
// the bare :root palette, dark is the html[data-theme="dark"] block. The choice lives in localStorage so
// main.tsx can apply it before first paint (no flash).
//
// Before this, OpenEdu shipped a black CRT look with nine recolors, a "universal" Dark/Light pair and a
// scanline overlay. Those ids are still in people's localStorage and in exported settings files, so
// every read goes through normalizeThemeChoice(), which maps them onto the two modes.

export type ThemeId = "light" | "dark";
export type ThemeChoice = ThemeId | "system";

export interface Theme {
  id: ThemeId;
  name: string;
  blurb: string;
}

// The palettes that exist. "system" is a choice, not a palette: it resolves to one of these.
export const THEMES: Theme[] = [
  { id: "light", name: "Light", blurb: "Warm paper, navy ink." },
  { id: "dark", name: "Dark", blurb: "Deep blue, soft white ink." },
];

// What the Appearance section offers, in order.
export const THEME_CHOICES: ReadonlyArray<{ id: ThemeChoice; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match my computer" },
];

export const DEFAULT_THEME_ID: ThemeId = "light";
const STORAGE_KEY = "oe-theme";
// The retired "CRT off" preference. Nothing reads it any more; applyTheme() deletes it.
const LEGACY_CRT_OFF_KEY = "oe-crt-off";

// Every id the CRT-era picker could have stored. All of them were black-background screens, so a user
// who chose one chose a dark screen. ("dark" and "light" existed then too and keep their meaning.)
export const LEGACY_DARK_THEME_IDS: ReadonlySet<string> = new Set([
  "ice", "green", "amber", "tangerine", "crimson", "vapor", "synthwave", "ultraviolet",
]);

// Map any stored or imported value onto a current choice.
//   unset / "openedu" / unknown → light   ("openedu" was the default; nobody picked it on purpose)
//   "light" / "dark" / "system" → as-is
//   any CRT recolor             → dark
export function normalizeThemeChoice(raw: unknown): ThemeChoice {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  if (typeof raw === "string" && LEGACY_DARK_THEME_IDS.has(raw)) return "dark";
  return DEFAULT_THEME_ID;
}

// Is this a theme id some version of OpenEdu wrote? Used by settings import to tell an old export
// (map it) from a garbage value (skip it).
export function isRecognizedThemeId(raw: unknown): raw is string {
  return typeof raw === "string"
    && (raw === "openedu" || raw === "light" || raw === "dark" || raw === "system" || LEGACY_DARK_THEME_IDS.has(raw));
}

// Which palette a choice paints with. Pure, so "Match my computer" is testable without a DOM.
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function getThemeChoice(): ThemeChoice {
  try {
    return normalizeThemeChoice(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

// The palette on screen right now.
export function getResolvedTheme(): ThemeId {
  return resolveTheme(getThemeChoice(), systemPrefersDark());
}

function paint(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  document.documentElement.style.colorScheme = id;
}

// Apply (and persist) a choice: set data-theme on <html> to the resolved palette, store the choice, and
// broadcast `oe-theme-change` so the titlebar toggle and the Appearance section stay in sync.
export function applyTheme(raw: unknown): ThemeChoice {
  const choice = normalizeThemeChoice(raw);
  paint(resolveTheme(choice, systemPrefersDark()));
  try {
    localStorage.setItem(STORAGE_KEY, choice);
    localStorage.removeItem(LEGACY_CRT_OFF_KEY);
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("oe-theme-change", { detail: choice })); } catch { /* ignore */ }
  return choice;
}

// Follow the OS light/dark setting while the choice is "Match my computer". Call once at startup.
export function watchSystemTheme(): void {
  try {
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      if (getThemeChoice() === "system") applyTheme("system");
    });
  } catch { /* ignore — older webviews without matchMedia listeners just don't follow live */ }
}
