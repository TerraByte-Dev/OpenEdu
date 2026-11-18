import RestoreSteps from "./RestoreSteps";
import { APP_NAME } from "../lib/product";

// Shown when OpenEdu could not read the learner list at launch, usually a
// file damaged by a power cut (#171). Without it the app would stay blank: no picker, no Settings, and
// no way to the restore steps.
//
// `migrationError` is set when the file opened but this version's update to it failed. Then there is no
// Try again: the plugin will not run the update twice in one session (db.ts getDb), so only closing and
// reopening the app runs it again, and the app stops here rather than run on the old layout.
export default function StartupFailed({ onRetry, migrationError = null }: { onRetry: () => void; migrationError?: string | null }) {
  return (
    <div role="alert" className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-5 p-8 bg-bg">
      <h1 className="text-2xl font-semibold text-danger" style={{ fontFamily: "var(--font-display)" }}>
        {migrationError ? `${APP_NAME} could not update its learner data.` : `${APP_NAME} could not open its learner data.`}
      </h1>
      {migrationError ? (
        <>
          <p className="text-base text-ink max-w-prose leading-relaxed">
            This version of {APP_NAME} changes how learner data is stored, and that change did not finish, so{" "}
            {APP_NAME} stopped here instead of running without it. Close {APP_NAME} and open it again. If you
            see this screen again, the file may be damaged: restore your most recent backup. If there is no
            backup, ask the person who looks after this computer before using {APP_NAME} any more.
          </p>
          <p className="text-sm text-[var(--ink-dim)] max-w-prose break-words">Details for whoever helps you: {migrationError}</p>
        </>
      ) : (
        <>
          <p className="text-base text-ink max-w-prose leading-relaxed">
            The file may be damaged. This can happen after a power cut. Try again first. If it still does not
            open, restore your most recent backup. If there is no backup, ask the person who looks after this
            computer before using {APP_NAME} any more.
          </p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>
        </>
      )}
      <div className="w-full max-w-prose">
        <p className="text-sm text-ink mb-2">How to restore a backup:</p>
        <RestoreSteps />
      </div>
    </div>
  );
}
