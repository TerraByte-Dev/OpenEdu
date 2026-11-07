import { useEffect, useState } from "react";
import { appConfigDir, join } from "@tauri-apps/api/path";

// The steps to restore a learner-data backup by hand. Shown in Settings > Learner data, and on the
// startup-failure screen, where Settings cannot be reached.
export default function RestoreSteps() {
  const [dbPath, setDbPath] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    // tauri-plugin-sql keeps "sqlite:openedu.db" in the app CONFIG dir (wrapper.rs, app_config_dir()).
    appConfigDir()
      .then((dir) => join(dir, "openedu.db"))
      .then((p) => { if (mounted) setDbPath(p); })
      .catch(() => { /* the help text falls back to the Windows path */ });
    return () => { mounted = false; };
  }, []);

  const shownPath = dbPath ?? "%APPDATA%\\com.terrabytesolutions.openedu\\openedu.db";

  return (
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
  );
}
