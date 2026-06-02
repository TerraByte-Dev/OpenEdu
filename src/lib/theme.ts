// Color/appearance themes. The whole UI is CSS-variable driven (src/index.css) and the CRT overlay is
// toggled by an `html.crt-off` class. A theme is just a named bundle of CSS-var overrides — declared in
// index.css under [data-theme="…"] — plus a CRT/font intent. We persist the choice to localStorage so it
// can be applied before first paint (no flash), mirroring the existing `oe-crt-off` mechanism.
//
// Two families:
//   • "crt"        — keep the OpenEdu look (scanlines + mono UI chrome), just recolored.
//   • "universal"  — drop the CRT overlay + switch to clean sans fonts, so the app "feels like a new app"
//                    for users who don't want the TerraByte/CRT theming.

export type ThemeFamily = "crt" | "universal";

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  family: ThemeFamily;
  // Swatch shown on the picker card — must mirror the [data-theme] block in index.css.
  swatch: { bg: string; accent: string; ink: string };
}

export const THEMES: Theme[] = [
  // CRT family — ordered around the color wheel. Most carry a tinted background (synthwave-style) for flair.
  { id: "openedu",     name: "OpenEdu",     blurb: "Blue phosphor CRT — the original.",     family: "crt",       swatch: { bg: "#000000", accent: "#00C6FF", ink: "#6DD4EE" } },
  { id: "ice",         name: "Ice",         blurb: "Cool cyan-white on deep navy.",          family: "crt",       swatch: { bg: "#02040c", accent: "#6FE6FF", ink: "#BFEFFF" } },
  { id: "green",       name: "Green",       blurb: "Classic P1 green phosphor.",             family: "crt",       swatch: { bg: "#000000", accent: "#2BFF88", ink: "#8FFFC0" } },
  { id: "amber",       name: "Amber",       blurb: "Warm amber terminal glow.",              family: "crt",       swatch: { bg: "#000000", accent: "#FFB000", ink: "#FFD074" } },
  { id: "tangerine",   name: "Tangerine",   blurb: "Hot orange on charred black.",           family: "crt",       swatch: { bg: "#060300", accent: "#FF7A18", ink: "#FFC089" } },
  { id: "crimson",     name: "Crimson",     blurb: "Blood-red neon on deep maroon.",         family: "crt",       swatch: { bg: "#060102", accent: "#FF2E4D", ink: "#FF94A2" } },
  { id: "vapor",       name: "Vapor",       blurb: "Vaporwave pink + cyan duotone.",         family: "crt",       swatch: { bg: "#070213", accent: "#FF8AD8", ink: "#93E6FF" } },
  { id: "synthwave",   name: "Synthwave",   blurb: "Magenta neon on deep violet.",           family: "crt",       swatch: { bg: "#05000c", accent: "#FF3AC8", ink: "#FF9CE6" } },
  { id: "ultraviolet", name: "Ultraviolet", blurb: "Electric violet on midnight indigo.",    family: "crt",       swatch: { bg: "#050316", accent: "#A06BFF", ink: "#C9B0FF" } },
  // Universal family — neutral, no CRT, clean sans fonts.
  { id: "dark",        name: "Dark",        blurb: "Clean neutral dark — no CRT.",           family: "universal", swatch: { bg: "#0d1117", accent: "#4493f8", ink: "#c9d1d9" } },
  { id: "light",       name: "Light",       blurb: "Bright neutral light — no CRT.",         family: "universal", swatch: { bg: "#ffffff", accent: "#0969da", ink: "#1f2328" } },
];

export const DEFAULT_THEME_ID = "openedu";
const STORAGE_KEY = "oe-theme";
const CRT_OFF_KEY = "oe-crt-off";

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function getThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

// Only CRT-family themes expose the manual CRT on/off toggle (universal themes are intrinsically off).
export function themeSupportsCrt(id: string): boolean {
  return getTheme(id).family === "crt";
}

// ── Manual CRT preference (the titlebar toggle + Appearance tab share this) ──────────────────────────────
export function getCrtOff(): boolean {
  try { return localStorage.getItem(CRT_OFF_KEY) === "1"; } catch { return false; }
}

// Set the manual CRT preference: persist, toggle the class, and broadcast so any open surface (titlebar,
// Appearance tab) stays in sync. Only meaningful under CRT themes — universal themes force the overlay off.
export function setCrtOff(off: boolean): void {
  try { localStorage.setItem(CRT_OFF_KEY, off ? "1" : "0"); } catch { /* ignore */ }
  document.documentElement.classList.toggle("crt-off", off);
  try { window.dispatchEvent(new CustomEvent("oe-crt-change", { detail: off })); } catch { /* ignore */ }
}

// Apply (and persist) a theme: set data-theme on <html>, and reconcile the CRT overlay —
//   • universal theme → force the overlay off (the CSS hides scanlines/grid/vignette), WITHOUT touching the
//     stored manual preference, so returning to a CRT theme restores whatever the user last chose;
//   • crt theme       → honor the user's manual CRT preference (oe-crt-off).
// Dispatches `oe-theme-change` so decoupled listeners (e.g. the Titlebar) can react. Returns the theme.
export function applyTheme(id: string): Theme {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle("crt-off", theme.family === "universal" ? true : getCrtOff());
  try { localStorage.setItem(STORAGE_KEY, theme.id); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("oe-theme-change", { detail: theme.id })); } catch { /* ignore */ }
  return theme;
}
