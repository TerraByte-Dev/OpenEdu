import { afterEach, describe, expect, it } from "vitest";
import { getBackupStatus, resetBackupStatusForTests, runBackup, subscribeBackupStatus, type BackupStatus } from "./backup-status";
import { describeBackupError, type BackupDestination, type BackupResult } from "./db-resilience";

const BUSY = "A backup is already being saved. Wait until it finishes, then try again."; // backup.rs BUSY

const dest: BackupDestination = { partial: "E:/backup.db.partial", finish: async () => "E:/backup.db", abandon: async () => {} };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => resetBackupStatusForTests());

describe("runBackup (Settings › Learner data's backup, kept outside the section)", () => {
  it("leaving the section mid-copy and coming back shows the copy saving, then Backup saved", async () => {
    const copy = deferred<BackupResult>();
    // The first visit: the section subscribes, the parent starts a backup.
    const firstVisit: BackupStatus[] = [];
    const leave = subscribeBackupStatus((s) => firstVisit.push(s));
    const running = runBackup(async () => dest, () => copy.promise);
    await Promise.resolve();
    expect(getBackupStatus()).toEqual({ saving: true });

    // The parent opens another section: this one unmounts and stops listening.
    leave();
    // ...and comes back while the copy is still running: the new section starts from the kept status.
    expect(getBackupStatus()).toEqual({ saving: true });
    const secondVisit: BackupStatus[] = [];
    subscribeBackupStatus((s) => secondVisit.push(s));

    copy.resolve({ path: "E:/backup.db", approxBytes: 2_500_000 });
    await running;
    const done = { saving: false, ok: true, msg: "Backup saved to E:/backup.db (about 3 MB)." };
    expect(getBackupStatus()).toEqual(done);
    expect(secondVisit).toEqual([done]);
    expect(firstVisit).toEqual([null, { saving: true }]);
  });

  it("a second backup refused with BUSY says to wait for the words the page will show", async () => {
    await runBackup(async () => { throw BUSY; }, async () => { throw new Error("never copies"); });
    const s = getBackupStatus();
    expect(s).toEqual({ saving: false, ok: false, msg: describeBackupError(BUSY) });
    expect(s && !s.saving && s.msg).toMatch(/Wait until this page says "Backup saved"/);
  });

  it("a cancelled dialog leaves no status, and a failed copy says why", async () => {
    await runBackup(async () => null, async () => { throw new Error("never copies"); });
    expect(getBackupStatus()).toBeNull();
    await runBackup(async () => dest, async () => { throw new Error("database or disk is full"); });
    expect(getBackupStatus()).toEqual({ saving: false, ok: false, msg: describeBackupError(new Error("database or disk is full")) });
  });
});
