// Which chat thread a tutor turn belongs to, and what that means when the student switches threads
// while it is still running (#246). ChatTab is the only caller; the rules live here so they are tested.
//
// A turn belongs to the thread it was sent in. Its messages are always saved to that thread, never to
// whichever one is on screen when they arrive. Showing a different thread abandons the turn.

/**
 * Does opening `nextThread` abort the turn in flight?
 *
 * `turnThread` is `undefined` when no turn is running, and `null` while a new conversation's thread is
 * still being created. The send path records the new id before it tells the rail to open that thread,
 * so the rail following the turn into its own new thread is not a switch.
 */
export function threadSwitchAbortsTurn(turnThread: string | null | undefined, nextThread: string | null): boolean {
  return turnThread !== undefined && turnThread !== nextThread;
}

/** Whether a turn's messages go on screen: only while its own thread is the one shown. */
export function turnIsShown(turnThread: string, shownThread: string | null | undefined): boolean {
  return turnThread === shownThread;
}

/**
 * Where a turn's reply lands once it is saved to its own thread. It is appended to the transcript only
 * while that thread is shown, and auto-read (K-2) only when it is shown, finished uninterrupted, and
 * auto-read is on. A turn abandoned by a thread switch is interrupted, so it is never voiced, even if
 * the student has already switched back.
 */
export function turnLanding(p: {
  turnThread: string;
  shownThread: string | null | undefined;
  interrupted: boolean;
  autoRead: boolean;
}): { show: boolean; speak: boolean } {
  const show = turnIsShown(p.turnThread, p.shownThread);
  return { show, speak: show && p.autoRead && !p.interrupted };
}
