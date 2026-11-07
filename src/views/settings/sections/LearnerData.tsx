import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { backupLearnerData } from "../../../lib/db";
import { backupFileName, describeBackupError, formatApproxSize } from "../../../lib/db-resilience";
import { Section, SettingRow, ActionButton } from "../primitives";

// Backup of every learner's courses, chats, notes, quizzes and progress. Power cuts are routine where
// OpenEdu runs, so a copy on a USB stick is the recovery plan. The copy is made by SQLite itself
// (VACUUM INTO, through the sql plugin), so no file-system permission is needed.
export default function LearnerData() {
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // tauri-plugin-sql keeps "sqlite:openedu.db" in the app CONFIG dir (wrapper.rs, app_config_dir()).
    appConfigDir()
      .then((dir) => join(dir, "openedu.db"))
      .then((p) => { if (mounted.current) setDbPath(p); })
      .catch(() => { /* the help text falls back to the Windows path */ });
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

  const shownPath = dbPath ?? "%APPDATA%\\com.terrabytesolutions.openedu\\openedu.db";

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
            <ActionButton primary onClick={backUp} busyLabel="Saving backup…">Back up all learner data</ActionButton>
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
          <ol className="list-decimal pl-5 space-y-1.5 text-xs text-ink leading-relaxed max-w-prose">
            <li>Close OpenEdu.</li>
            <li>
              Open the folder that holds this file:
              <span className="block mt-1 font-mono text-[var(--ink-faint)] break-all select-all">{shownPath}</span>
            </li>
            <li>
              Make a new folder there called <span className="font-mono">old</span>. Move <span className="font-mono">openedu.db</span> into
              it, and also <span className="font-mono">openedu.db-wal</span> and <span className="font-mono">openedu.db-shm</span> if you see them.
              Keep them; someone may be able to recover more from them later.
            </li>
            <li>
              Copy your backup file into the first folder and rename the copy. If the other file names there end in
              {" "}<span className="font-mono">.db</span>, type <span className="font-mono">openedu.db</span>. If they don't
              (Windows is hiding file endings), type just <span className="font-mono">openedu</span>, or Windows will name
              it <span className="font-mono">openedu.db.db</span> and OpenEdu will start with no data.
            </li>
            <li>Start OpenEdu.</li>
          </ol>
        </SettingRow>
      </Section>
    </>
  );
}
