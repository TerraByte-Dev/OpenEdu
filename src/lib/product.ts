// The product's name in user-facing copy, in one place (issue #278). An edition that merges this repo
// (TerraTutor) overrides these lines instead of re-renaming every string on each upstream merge.
// Copy only: code identifiers, the DB file name, the Tauri identifier, the settings-file `kind` and the
// prompts sent to the model keep their own literals.

export const APP_NAME = "OpenEdu";

/** The curated reference library, as the learner sees it named. */
export const LIBRARY_NAME = `${APP_NAME} Library`;

/** Stems for files the app offers to save: `<stem>-YYYY-MM-DD-HHMM.db`, `<stem>-YYYY-MM-DD.json`. */
export const BACKUP_FILE_STEM = "openedu-backup";
export const SETTINGS_FILE_STEM = "openedu-settings";
