// What ChatTab writes to the transcript for a finished turn. Pure, so the k12-flow eval builds its
// history through the same function the app uses.
//
// An interrupted reply is saved WITH a marker rather than silently as a finished answer. Two bugs
// met here before #86: a stall left `controller.signal.aborted` false, so a truncated half-sentence
// was written as the tutor's final word; and a real abort wrote nothing at all, leaving the
// student's question hanging in the transcript with no reply forever, which then became history
// that teaches the model unanswered questions are normal.

/** The assistant message to persist, or null when the turn produced no text (nothing is saved). */
export function persistedReply(text: string, stopReason: string): string | null {
  if (!text.trim()) return null;
  const suffix = stopReason === "stalled"
    ? "\n\n_[the tutor stopped responding — ask again to continue]_"
    : stopReason === "aborted"
      ? "\n\n_[stopped]_"
      : stopReason === "length"
        ? "\n\n_[cut off at the length limit — ask the tutor to continue]_"
        : "";
  return text + suffix;
}
