import RestoreSteps from "./RestoreSteps";

// Shown when OpenEdu could not read who uses this computer or the learner list at launch, usually a
// file damaged by a power cut (#171). Without it the app would stay blank: no picker, no Settings, and
// no way to the restore steps.
export default function StartupFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-5 p-8 bg-bg">
      <h1 className="text-2xl font-semibold text-danger" style={{ fontFamily: "var(--font-display)" }}>
        OpenEdu could not open its learner data.
      </h1>
      <p className="text-base text-ink max-w-prose leading-relaxed">
        The file may be damaged. This can happen after a power cut. Try again first. If it still does not
        open, restore your most recent backup. If there is no backup, ask the person who looks after this
        computer before using OpenEdu any more.
      </p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>
      <div className="w-full max-w-prose">
        <p className="text-sm text-ink mb-2">How to restore a backup:</p>
        <RestoreSteps />
      </div>
    </div>
  );
}
