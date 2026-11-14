import { cloudNotice, type CloudFeature } from "../../lib/privacy";

// The one-time confirm before a feature that sends the learner's chats to a company is turned on. Inline in
// the section, not a pop-up: it reads as information, and Settings stays usable around it.
export function CloudNoticePanel({ feature, onConfirm, onCancel }: { feature: CloudFeature; onConfirm: () => void; onCancel: () => void }) {
  const n = cloudNotice(feature);
  const id = `cloud-notice-${feature}`;
  return (
    <div role="group" aria-labelledby={id} className="mt-4 max-w-prose rounded-[var(--radius-control)] border border-[var(--rule-strong)] bg-[var(--panel-tint)] p-4">
      <p id={id} className="text-sm font-semibold text-ink">{n.title}</p>
      <p className="mt-1.5 text-sm text-ink leading-relaxed">{n.body}</p>
      <div className="mt-3 flex gap-2 flex-wrap">
        <button type="button" onClick={onConfirm} className="btn btn-primary">{n.confirm}</button>
        <button type="button" onClick={onCancel} className="btn">{n.cancel}</button>
      </div>
    </div>
  );
}
