// Export / import of user settings as a portable JSON document. Lets a user carry a consistent config
// between machines (and, later, between TerraByte apps). Persistence lives in the same plugin-store file
// (settings.json) + the permissions store + localStorage theme — this module only reads/writes through them.
// No fs/dialog plugin is required: export is a browser Blob download (with a clipboard fallback in the UI),
// import reads a File via FileReader or pasted text. Key names, the secret predicate, and the import
// allow-list all come from store-keys.ts; parsing/validation comes from settings-schema.ts (both pure).

import { Store } from "@tauri-apps/plugin-store";
import { STORE_FILE, isSecretKey, NON_PORTABLE_KEYS, ALLOWED_IMPORT_KEYS, isLearnerScopedKey } from "./store-keys";
import {
  type SettingsExport, EXPORT_KIND, EXPORT_VERSION,
  parseSettingsExport, sanitizeImportedPermissions, importedThemeChoice,
} from "./settings-schema";
import { loadPermissionRules, savePermissionRules } from "./permissions";
import { applyTheme, getThemeChoice } from "./theme";
import { SETTINGS_FILE_STEM } from "./product";

export type { SettingsExport } from "./settings-schema";

// Build the export payload from the live stores. `includeSecrets` controls whether API/Tavily keys ride
// along (off by default — sharing an export shouldn't leak keys).
export async function gatherSettings(includeSecrets: boolean): Promise<SettingsExport> {
  const store = await Store.load(STORE_FILE);
  const entries = await store.entries();

  const settings: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (NON_PORTABLE_KEYS.has(key) || isLearnerScopedKey(key)) continue;
    if (!includeSecrets && isSecretKey(key)) continue;
    settings[key] = value;
  }

  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    theme: getThemeChoice(),
    settings,
    permissions: await loadPermissionRules(),
  };
}

// Serialize an export payload to pretty JSON.
export function serializeSettings(payload: SettingsExport): string {
  return JSON.stringify(payload, null, 2);
}

// Trigger a browser download of the export. In the Tauri webview this saves to the OS download location;
// the Settings UI also offers a clipboard copy as a guaranteed fallback.
export function downloadSettingsFile(payload: SettingsExport): void {
  const json = serializeSettings(payload);
  const stamp = payload.exportedAt.slice(0, 10);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${SETTINGS_FILE_STEM}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parse + validate a settings file's text (delegates to the pure schema validator).
export const parseSettingsFile = parseSettingsExport;

export interface ImportSummary {
  settingsApplied: number;
  permissionsApplied: boolean;
  themeApplied: boolean;
  themeSkipped: boolean;
}

// Apply a parsed export back into the live stores. Only allow-listed keys are written; permissions are
// sanitized against the known tool/mode/decision space; a CRT-era theme id is mapped onto light/dark, an
// unrecognized one is skipped (not silently coerced), and an old file's `crtOff` is ignored. The theme is
// applied through theme.ts so open surfaces (titlebar/Appearance) stay in sync.
export async function applyImportedSettings(payload: SettingsExport): Promise<ImportSummary> {
  const store = await Store.load(STORE_FILE);

  let settingsApplied = 0;
  for (const [key, value] of Object.entries(payload.settings ?? {})) {
    if (!ALLOWED_IMPORT_KEYS.has(key)) continue;
    await store.set(key, value);
    settingsApplied++;
  }
  if (settingsApplied > 0) await store.save();

  const sanitized = sanitizeImportedPermissions(payload.permissions);
  let permissionsApplied = false;
  if (sanitized) {
    await savePermissionRules(sanitized);
    permissionsApplied = true;
  }

  let themeApplied = false;
  let themeSkipped = false;
  const choice = importedThemeChoice(payload.theme);
  if (choice) {
    applyTheme(choice);
    themeApplied = true;
  } else if (payload.theme !== undefined) {
    themeSkipped = true; // unknown theme id — leave the current theme untouched
  }

  return { settingsApplied, permissionsApplied, themeApplied, themeSkipped };
}
