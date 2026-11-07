import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { backupLearnerData } from "../../../lib/db";
import { backupFileName, describeBackupError, formatApproxSize } from "../../../lib/db-resilience";
import { Section, SettingRow, ActionButton } from "../primitives";
import type { SectionProps } from "../types";
import RestoreSteps from "../../../components/RestoreSteps";

// Backup of every learner's courses, chats, notes, quizzes and progress. Power cuts are routine where
// OpenEdu runs, so a copy on a USB stick is the recovery plan. The copy is made by SQLite itself
// (VACUUM INTO, through the sql plugin), so no file-system permission is needed. The copy holds every
// learner's data, so in a class or school it is behind the teacher PIN (guardEntry "learner-data-backup").
export default function LearnerData({ usage }: SectionProps) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const backUp = async () => {
    setResult(null);
    const path = await save({
      title: "Back up all learner data",
      defaultPath: backupFileName(new Date()),
      filters: [{ name: "OpenEdu backup", extensions: ["db"] }],
    });
    if (!path) return; // cancelled
    try {
      const r = await backupLearnerData(path);
      const size = r.approxBytes ? ` (${formatApproxSize(r.approxBytes)})` : "";
      if (mounted.current) setResult({ ok: true, msg: `Backup saved to ${r.path}${size}.` });
    } catch (e) {
      if (mounted.current) setResult({ ok: false, msg: describeBackupError(e) });
    }
  };

  return (
    <>
      <Section
        title="Backup"
        description="Everything learners have done in OpenEdu is kept in one file on this computer. A power cut can damage it. Keep a recent copy somewhere else, such as a USB stick."
        keywords="backup learner data database copy usb save power cut"
      >
        <SettingRow
          label="Back up all learner data"
          help="Saves one file with every course, chat, note, quiz and progress record. You can keep using OpenEdu while it saves. Make a new backup often, for example at the end of each day."
        >
          <div className="space-y-2.5">
            <ActionButton primary onClick={() => (usage ? usage.guard("learner-data-backup", backUp) : backUp())} busyLabel="Saving backup…">Back up all learner data</ActionButton>
            {result && (
              <p className={`text-xs break-all ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
                {result.ok ? "✓ " : "✗ "}{result.msg}
              </p>
            )}
          </div>
        </SettingRow>
      </Section>

      <Section
        title="Restore"
        description="Use a backup if OpenEdu warns that learner data is damaged, or if work has gone missing."
        keywords="restore backup damaged recover replace file power cut"
      >
        <SettingRow label="How to restore a backup" help="Restoring replaces all current learner data with the data in the backup. Anything done after that backup was made will be lost.">
          <RestoreSteps />
        </SettingRow>
      </Section>
    </>
  );
}
