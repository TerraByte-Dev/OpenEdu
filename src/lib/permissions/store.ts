// Persistence for permission rules (see docs/ARCHITECTURE.md). Stored via @tauri-apps/plugin-store in
// permissions.json under %APPDATA%/com.terrabytesolutions.openedu/ — the same pattern as src/lib/store.ts.
// The active rule set = the built-in defaults merged with the user's per-tool overrides from Settings.

import { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_PERMISSION_RULES, type PermissionRules } from "./rules";

const FILE = "permissions.json";
const KEY = "rules";

let storePromise: Promise<Store> | null = null;
let cache: PermissionRules | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

// Active rule set (defaults ← persisted overrides). Cached after first load; cheap to call per turn.
export async function loadPermissionRules(): Promise<PermissionRules> {
  if (cache) return cache;
  try {
    const saved = await (await getStore()).get<PermissionRules>(KEY);
    cache = saved ? { ...DEFAULT_PERMISSION_RULES, ...saved } : { ...DEFAULT_PERMISSION_RULES };
  } catch {
    cache = { ...DEFAULT_PERMISSION_RULES };
  }
  return cache;
}

// Persist the full rule set and refresh the cache.
export async function savePermissionRules(rules: PermissionRules): Promise<void> {
  const store = await getStore();
  await store.set(KEY, rules);
  await store.save();
  cache = { ...rules };
}
