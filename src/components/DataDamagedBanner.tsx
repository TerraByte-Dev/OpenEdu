// Shown when the boot-time `PRAGMA quick_check` finds damage (usually after a power cut). Plain words and
// one next step: restore a backup. The technical detail goes to the console, not to the learner.

import { APP_NAME } from "../lib/product";

export default function DataDamagedBanner({ onHowToRestore, onDismiss }: { onHowToRestore: () => void; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 px-4 py-3 border-b border-danger/50 bg-danger-tint text-sm text-ink shrink-0">
      <span className="w-2 h-2 mt-1.5 rounded-full bg-danger shrink-0" />
      <div className="flex-1 min-w-0 leading-relaxed">
        <strong className="text-danger">Some learner data may be damaged.</strong>{" "}
        This can happen after a power cut. Some work may be missing or may not open.
        The next step is to restore your most recent backup. If there is no backup, ask the person who looks
        after this computer before using {APP_NAME} any more.
        <div className="mt-2">
          <button type="button" onClick={onHowToRestore} className="btn">How to restore a backup</button>
        </div>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Hide this warning" className="text-danger hover:text-danger text-lg leading-none">✕</button>
    </div>
  );
}
