// In-app auto-update via the Tauri updater plugin. The app checks the configured endpoint (a `latest.json`
// on the latest GitHub Release — see tauri.conf.json → plugins.updater), and downloads/installs only
// updates signed with the private key matching the bundled public key. After install it relaunches into the
// new version. Used by the About tab (manual) and the launch-time UpdateNotice banner (automatic).

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

// Returns an Update handle when a newer signed version is available, or null when already up to date.
// Throws if the check itself fails (offline, endpoint unreachable) — callers handle that gracefully.
export async function checkForUpdate(): Promise<Update | null> {
  return await check();
}

// Download + install the update (signature verified against the bundled pubkey), reporting download
// progress as a percentage (or null when the total size is unknown), then relaunch into the new version.
export async function installUpdate(update: Update, onProgress?: (pct: number | null) => void): Promise<void> {
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? Math.min(100, Math.round((downloaded / total) * 100)) : null);
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  await relaunch();
}
