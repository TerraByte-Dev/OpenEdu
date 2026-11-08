// What ChatTab writes to the transcript for a finished turn. Pure, so the k12-flow eval builds its
// history through the same function the app uses.
//
// An interrupted reply is saved WITH a marker rather than silently as a finished answer. Two bugs
// met here before #86: a stall left `controller.signal.aborted` false, so a truncated half-sentence
// was written as the tutor's final word; and a real abort wrote nothing at all, leaving the
// student's question hanging in the transcript with no reply forever, which then became history
// that teaches the model unanswered questions are normal.

// The marker each interrupted stop reason adds. Any other stop reason saves the text as is.
const MARKERS = {
  stalled: "\n\n_[the tutor stopped responding — ask again to continue]_",
  aborted: "\n\n_[stopped]_",
  length: "\n\n_[cut off at the length limit — ask the tutor to continue]_",
} as const;

type MarkedStop = keyof typeof MARKERS;

/** The assistant message to persist, or null when the turn produced no text (nothing is saved). */
export function persistedReply(text: string, stopReason: string): string | null {
  if (!text.trim()) return null;
  return text + (Object.prototype.hasOwnProperty.call(MARKERS, stopReason) ? MARKERS[stopReason as MarkedStop] : "");
}

/**
 * The reverse of persistedReply: the text the model produced, and the interrupted stop reason its
 * marker records ("complete" when there is no marker). The kernel uses it to see a saved reply the
 * way ChatTab saw it when it built that reply's chips.
 */
export function replyFromPersisted(saved: string): { text: string; stopReason: "complete" | MarkedStop } {
  for (const stopReason of Object.keys(MARKERS) as MarkedStop[]) {
    if (saved.endsWith(MARKERS[stopReason])) return { text: saved.slice(0, -MARKERS[stopReason].length), stopReason };
  }
  return { text: saved, stopReason: "complete" };
}
