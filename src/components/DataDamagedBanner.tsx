// Shown when the boot-time `PRAGMA quick_check` finds damage (usually after a power cut). Plain words and
// one next step: restore a backup. The technical detail goes to the console, not to the learner.
export default function DataDamagedBanner({ onHowToRestore, onDismiss }: { onHowToRestore: () => void; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 px-4 py-3 border-b border-red-500/50 bg-red-500/10 text-sm text-ink shrink-0">
      <span className="w-2 h-2 mt-1.5 rounded-full bg-red-400 shrink-0" />
      <div className="flex-1 min-w-0 leading-relaxed">
        <strong className="text-red-300">Some learner data may be damaged.</strong>{" "}
        This can happen after a power cut. Some work may be missing or may not open.
        The next step is to restore your most recent backup. If there is no backup, ask the person who looks
        after this computer before using OpenEdu any more.
        <div className="mt-2">
          <button type="button" onClick={onHowToRestore} className="btn">How to restore a backup</button>
        </div>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Hide this warning" className="text-red-300 hover:text-red-200 text-lg leading-none">✕</button>
    </div>
  );
}
