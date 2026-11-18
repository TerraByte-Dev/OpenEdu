// The state of the learner-data backup started from Settings › Learner data, kept outside the section.
// Settings mounts only the open section, so leaving it unmounts LearnerData while the copy keeps running.
// Kept here, the outcome outlives the section: coming back mid-copy shows "Saving backup…" and then
// "Backup saved", which is what the BUSY message (describeBackupError) tells the parent to wait for.
// It lives as long as the webview does.

import { describeBackupError, formatApproxSize, type BackupDestination, type BackupResult } from "./db-resilience";

export type BackupStatus = { saving: true } | { saving: false; ok: boolean; msg: string } | null;

let status: BackupStatus = null;
const listeners = new Set<(s: BackupStatus) => void>();

function publish(next: BackupStatus) {
  status = next;
  for (const l of listeners) l(next);
}

export function getBackupStatus(): BackupStatus {
  return status;
}

/** Hear every change until the returned function is called (on unmount). */
export function subscribeBackupStatus(listener: (s: BackupStatus) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Pick a destination and save one backup, publishing each step. A cancelled dialog leaves no status.
 * Errors, including Rust's BUSY refusal, become a plain-words failure.
 */
export async function runBackup(
  pick: () => Promise<BackupDestination | null>,
  save: (dest: BackupDestination) => Promise<BackupResult>,
): Promise<void> {
  publish(null);
  try {
    const dest = await pick();
    if (!dest) return; // cancelled
    publish({ saving: true });
    const r = await save(dest);
    const size = r.approxBytes ? ` (${formatApproxSize(r.approxBytes)})` : "";
    publish({ saving: false, ok: true, msg: `Backup saved to ${r.path}${size}.` });
  } catch (e) {
    publish({ saving: false, ok: false, msg: describeBackupError(e) });
  }
}

/** Tests only: forget the last backup. */
export function resetBackupStatusForTests() {
  status = null;
  listeners.clear();
}
