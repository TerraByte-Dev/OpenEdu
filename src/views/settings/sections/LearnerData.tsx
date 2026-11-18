import { useEffect, useState } from "react";
import { backupLearnerData } from "../../../lib/db";
import { pickBackupDestination } from "../../../lib/backup-file";
import { backupFileName } from "../../../lib/db-resilience";
import { getBackupStatus, runBackup, subscribeBackupStatus } from "../../../lib/backup-status";
import { Section, SettingRow, ActionButton } from "../primitives";
import RestoreSteps from "../../../components/RestoreSteps";
import { APP_NAME } from "../../../lib/product";

// Backup of every learner's courses, chats, notes, quizzes and progress. Power cuts are routine where
// OpenEdu runs, so a copy on a USB stick is the recovery plan. The copy is made by SQLite itself
// (VACUUM INTO, through the sql plugin) under a temporary name, and Rust gives it the picked name only
// once it is whole (backup.rs), so no file-system permission is needed and a cut-short copy never looks
// like a backup. The copy is the whole
// file: on an install with several learners it holds all of them, PIN hashes included, so a restored
// copy still asks each PIN.
// The backup's progress and outcome live in backup-status.ts, not here: leaving this section unmounts it
// while the copy keeps running, and coming back must still show "Saving backup…" and then "Backup saved".
export default function LearnerData() {
  const [status, setStatus] = useState(getBackupStatus);
  useEffect(() => {
    setStatus(getBackupStatus()); // a change between the first render and this subscription
    return subscribeBackupStatus(setStatus);
  }, []);

  const backUp = () => runBackup(() => pickBackupDestination(backupFileName(new Date())), backupLearnerData);
  const saving = status?.saving === true;

  return (
    <>
      <Section
        title="Backup"
        description={`Everything learners have done in ${APP_NAME} is kept in one file on this computer. A power cut can damage it. Keep a recent copy somewhere else, such as a USB stick.`}
        keywords="backup learner data database copy usb save power cut"
      >
        <SettingRow
          label="Back up all learner data"
          help={`Saves one file with every course, chat, note, quiz and progress record. You can keep using ${APP_NAME} while it saves, but wait for "Backup saved" before you shut down or unplug the USB stick. Make a new backup often, for example at the end of each day.`}
        >
          <div className="space-y-2.5">
            <ActionButton primary disabled={saving} onClick={backUp} busyLabel="Saving backup…">Back up all learner data</ActionButton>
            {saving && (
              <p className="text-xs text-[var(--ink-dim)]">Saving backup… Wait for "Backup saved" before you shut down or unplug the USB stick.</p>
            )}
            {status && !status.saving && (
              <p className={`text-xs break-all ${status.ok ? "text-success" : "text-danger"}`}>
                {status.ok ? "✓ " : "✗ "}{status.msg}
              </p>
            )}
          </div>
        </SettingRow>
      </Section>

      <Section
        title="Restore"
        description={`Use a backup if ${APP_NAME} warns that learner data is damaged, or if work has gone missing.`}
        keywords="restore backup damaged recover replace file power cut"
      >
        <SettingRow label="How to restore a backup" help="Restoring replaces all current learner data with the data in the backup. Anything done after that backup was made will be lost.">
          <RestoreSteps />
        </SettingRow>
      </Section>
    </>
  );
}
