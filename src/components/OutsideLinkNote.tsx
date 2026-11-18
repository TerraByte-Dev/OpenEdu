import { useEffect, useState } from "react";
import { installLinkGuard, OUTSIDE_LINK_LINE } from "../lib/link-guard";

/**
 * Keeps every link that leaves the app from navigating the window (lib/link-guard.ts) and shows the
 * clicked one's address as one calm line a grown-up can copy. Mounted at the app root, so it covers
 * chat, lessons, Raise hand, resources, notes and diagrams, over the full-screen quiz and level test too.
 * App keys it by the active learner, so Switch learner clears an address one learner clicked.
 */
export default function OutsideLinkNote() {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");

  useEffect(() => installLinkGuard(document, (a) => { setAddress(a); setCopied("no"); }), []);

  if (address === null) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[10001] w-[min(36rem,calc(100vw-2rem))] flex items-start gap-3 rounded-[12px] border border-[var(--rule)] bg-panel shadow-[var(--shadow-soft)] px-4 py-3 text-sm text-[var(--ink)]"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[var(--ink-dim)]">{OUTSIDE_LINK_LINE}</span>
        <span className="block mt-1 break-all select-all font-lcd" style={{ userSelect: "all" }}>{address}</span>
      </span>
      <button
        type="button"
        className="btn shrink-0"
        style={{ fontSize: "0.9rem", padding: "6px 14px" }}
        onClick={() => { navigator.clipboard.writeText(address).then(() => setCopied("yes")).catch(() => setCopied("failed")); }}
      >
        {copied === "yes" ? "Copied" : copied === "failed" ? "Select it and copy" : "Copy"}
      </button>
      {/* A 44px round target, .btn's height. */}
      <button type="button" onClick={() => setAddress(null)} aria-label="Dismiss" className="inline-flex items-center justify-center w-11 h-11 rounded-full text-phosphor-bright hover:text-phosphor hover:bg-panel-lite text-lg leading-none shrink-0">✕</button>
    </div>
  );
}
