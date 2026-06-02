// Export / import of user settings as a portable JSON document. Lets a user carry a consistent config
// between machines (and, down the road, between TerraByte apps). Persistence still lives in the same
// @tauri-apps/plugin-store file (settings.json) + the permissions store + localStorage theme — this module
// only reads/writes through them. No fs/dialog plugin is required: export is a browser Blob download (with
// a clipboard fallback in the UI), import reads a File via FileReader or pasted text.

import { Store } from "@tauri-apps/plugin-store";
import { loadPermissionRules, savePermissionRules, type PermissionRules } from "./permissions";
import { applyTheme, getThemeId } from "./theme";

const SETTINGS_FILE = "settings.json";
const EXPORT_KIND = "openedu-settings";
const EXPORT_VERSION = 1;

// Keys that hold secrets — excluded from export unless the user explicitly opts in.
const SECRET_KEY_PREFIXES = ["apikey_"];
const SECRET_KEYS = new Set(["tavily_api_key"]);
// Large / regenerable caches we never want in a portable settings file.
const SKIP_KEYS = new Set(["library_manifest_cache", "library_manifest_cache_at"]);

// The only store keys an import is allowed to write. Anything else in an imported file is ignored — so a
// malformed or hand-edited file can't inject arbitrary keys into the store.
const ALLOWED_IMPORT_KEYS = new Set([
  "llm_provider",
  "gen_model",
  "chat_model",
  "embedding_provider",
  "embedding_model",
  "ollama_url",
  "library_enabled",
  "library_url",
  // secrets — only written when present (i.e. the file was exported with secrets included)
  "tavily_api_key",
  "apikey_ollama",
  "apikey_openai",
  "apikey_anthropic",
]);

export interface SettingsExport {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: string;
  theme: string;
  crtOff: boolean;
  settings: Record<string, unknown>;
  permissions: PermissionRules;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || SECRET_KEY_PREFIXES.some((p) => key.startsWith(p));
}

// Build the export payload from the live stores. `includeSecrets` controls whether API/Tavily keys ride
// along (off by default — sharing an export shouldn't leak keys).
export async function gatherSettings(includeSecrets: boolean): Promise<SettingsExport> {
  const store = await Store.load(SETTINGS_FILE);
  const entries = await store.entries();

  const settings: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (SKIP_KEYS.has(key)) continue;
    if (!includeSecrets && isSecretKey(key)) continue;
    settings[key] = value;
  }

  let crtOff = false;
  try { crtOff = localStorage.getItem("oe-crt-off") === "1"; } catch { /* ignore */ }

  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    theme: getThemeId(),
    crtOff,
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
  a.download = `openedu-settings-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parse + validate a settings file's text. Throws a friendly error on anything that isn't a recognizable
// OpenEdu settings export.
export function parseSettingsFile(text: string): SettingsExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const obj = parsed as Partial<SettingsExport>;
  if (!obj || obj.kind !== EXPORT_KIND) {
    throw new Error("Not an OpenEdu settings file.");
  }
  if (typeof obj.settings !== "object" || obj.settings === null) {
    throw new Error("Settings file is missing its settings block.");
  }
  return obj as SettingsExport;
}

export interface ImportSummary {
  settingsApplied: number;
  permissionsApplied: boolean;
  themeApplied: boolean;
}

// Apply a parsed export back into the live stores. Only allow-listed keys are written. Theme + permissions
// are applied when present. Returns a summary for the UI.
export async function applyImportedSettings(payload: SettingsExport): Promise<ImportSummary> {
  const store = await Store.load(SETTINGS_FILE);

  let settingsApplied = 0;
  for (const [key, value] of Object.entries(payload.settings ?? {})) {
    if (!ALLOWED_IMPORT_KEYS.has(key)) continue;
    await store.set(key, value);
    settingsApplied++;
  }
  if (settingsApplied > 0) await store.save();

  let permissionsApplied = false;
  if (payload.permissions && typeof payload.permissions === "object") {
    await savePermissionRules(payload.permissions);
    permissionsApplied = true;
  }

  let themeApplied = false;
  if (typeof payload.theme === "string") {
    if (typeof payload.crtOff === "boolean") {
      try { localStorage.setItem("oe-crt-off", payload.crtOff ? "1" : "0"); } catch { /* ignore */ }
    }
    applyTheme(payload.theme);
    themeApplied = true;
  }

  return { settingsApplied, permissionsApplied, themeApplied };
}
