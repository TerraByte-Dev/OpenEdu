// Which chat thread's messages are on screen, and loading them when the rail opens one (#270).
// ChatTab is the only caller; the sequencing lives here so it is tested.

export interface TranscriptLoader {
  /** The thread whose transcript is shown (or loading). `undefined` before the first open. */
  shown(): string | null | undefined;
  /**
   * The send path created thread `id` and already holds its transcript, so opening it must not fetch.
   * A fetch there would race the send's own append: it either duplicates the new message or resolves
   * with the rows from before the insert and wipes it.
   */
  claim(id: string): void;
  /** Show thread `id` (`null` = a not-yet-created conversation, an empty transcript). Returns the effect cleanup. */
  open(id: string | null): () => void;
}

export function transcriptLoader<M>(
  fetch: (threadId: string) => Promise<M[]>,
  apply: (messages: M[]) => void,
): TranscriptLoader {
  let shown: string | null | undefined = undefined;
  return {
    shown: () => shown,
    claim: (id) => { shown = id; },
    open: (id) => {
      if (shown === id) return () => {}; // already showing it; do not re-fetch
      shown = id;
      let alive = true;
      let landed = false;
      const land = (messages: M[]) => {
        if (!alive) return;
        landed = true;
        apply(messages);
      };
      if (id === null) land([]);
      else void fetch(id).then(land);
      return () => {
        alive = false;
        // A load cleaned up before it landed is dropped, so `id` is not on screen: forget it, or a
        // re-run of the same open (React StrictMode) would skip the fetch and show nothing.
        if (!landed && shown === id) shown = undefined;
      };
    },
  };
}
