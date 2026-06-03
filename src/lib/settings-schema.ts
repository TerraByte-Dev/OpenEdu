// Pure parse + validation for the settings export/import format. Kept Tauri-free (imports only the THEME
// list and the permission *rules* shape, never the plugin-store layer) so the import validation is
// unit-testable in node and so a hand-edited/corrupt file can never push malformed data into the app.

import { THEMES } from "./theme";
import {
  PERMISSION_ROWS, PERMISSION_EDITABLE_MODES, DEFAULT_PERMISSION_RULES,
  type PermissionDecision, type PermissionRules,
} from "./permissions/rules";

export const EXPORT_KIND = "openedu-settings";
export const EXPORT_VERSION = 1;

export interface SettingsExport {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: string;
  theme: string;
  crtOff: boolean;
  settings: Record<string, unknown>;
  permissions: PermissionRules;
}

export function isKnownThemeId(id: unknown): id is string {
  return typeof id === "string" && THEMES.some((t) => t.id === id);
}

const DECISIONS: ReadonlySet<string> = new Set<PermissionDecision>(["allow", "ask", "deny"]);

// Build a COMPLETE, VALID PermissionRules from untrusted import data: start from the built-in defaults,
// then overlay only recognized tool × editable-mode × decision triples. Anything unknown/garbage is
// dropped, so evaluate.ts never reads a malformed rule. Returns null when `raw` isn't a usable object
// (caller then leaves the current rules untouched).
export function sanitizeImportedPermissions(raw: unknown): PermissionRules | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: PermissionRules = {};
  for (const tool of PERMISSION_ROWS) {
    out[tool] = { ...DEFAULT_PERMISSION_RULES[tool] };
    const modes = src[tool];
    if (modes && typeof modes === "object" && !Array.isArray(modes)) {
      for (const mode of PERMISSION_EDITABLE_MODES) {
        const d = (modes as Record<string, unknown>)[mode];
        if (typeof d === "string" && DECISIONS.has(d)) {
          out[tool][mode] = d as PermissionDecision;
        }
      }
    }
  }
  return out;
}

// Parse + validate a settings file's text. Throws a friendly error on anything unrecognizable.
export function parseSettingsExport(text: string): SettingsExport {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("That file isn't valid JSON."); }
  const obj = parsed as Partial<SettingsExport>;
  if (!obj || obj.kind !== EXPORT_KIND) throw new Error("Not an OpenEdu settings file.");
  if (typeof obj.settings !== "object" || obj.settings === null || Array.isArray(obj.settings)) {
    throw new Error("Settings file is missing its settings block.");
  }
  return obj as SettingsExport;
}
