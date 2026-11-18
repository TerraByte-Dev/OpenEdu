import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNoteSaver, savePendingEdits, AUTOSAVE_DELAY_MS, type NoteDraft } from "./note-autosave";

// The saver NotesTab saves every note through (its write is db.ts updateNote; disk-full.test.ts runs it on a
// real SQLite). Here the write is a stand-in that records each call and can be held open or made to fail.

const A = { id: "a", courseId: "c1" };
const B = { id: "b", courseId: "c1" };
const SAVED = { title: "Halves", content: "" };
const draft = (n: { id: string; courseId: string }, content: string, title = "Halves"): NoteDraft => ({ ...n, title, content });

type Call = { draft: NoteDraft; resolve: () => void; reject: (e: unknown) => void };

function harness(mode: "instant" | "held" = "instant") {
  const calls: Call[] = [];
  const disk = new Map<string, string>();
  let failNext: unknown;
  const write = vi.fn((d: NoteDraft) => new Promise<void>((resolve, reject) => {
    const call: Call = {
      draft: d,
      resolve: () => { disk.set(d.id, d.content); resolve(); },
      reject,
    };
    calls.push(call);
    if (failNext !== undefined) { const e = failNext; failNext = undefined; reject(e); return; }
    if (mode === "instant") call.resolve();
  }));
  const saver = createNoteSaver(write);
  const events: string[] = [];
  saver.listen({
    saved: (d) => events.push(`saved ${d.id}:${d.content}`),
    failed: (d) => events.push(`failed ${d.id}:${d.content}`),
  });
  return { saver, write, calls, disk, events, failOnce: (e: unknown) => { failNext = e; } };
}

// Lets queued promise callbacks run (timers are fake here).
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("autosave while typing", () => {
  it("saves a few seconds after the last keystroke, once, with the newest words", async () => {
    const h = harness();
    h.saver.edit(draft(A, "One"), SAVED);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
    h.saver.edit(draft(A, "One half"), SAVED);
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
    expect(h.write).not.toHaveBeenCalled(); // still typing

    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.disk.get("a")).toBe("One half");
    expect(h.events).toEqual(["saved a:One half"]);
  });

  it("words the same as on disk are not written", async () => {
    const h = harness();
    h.saver.edit(draft(A, ""), SAVED);
    await h.saver.flush();
    expect(h.write).not.toHaveBeenCalled();
  });

  it("a flush (blur, another note, leaving the tab, closing) saves now and cancels the timer", async () => {
    const h = harness();
    h.saver.edit(draft(A, "One half"), SAVED);
    expect(await h.saver.flush()).toEqual(new Set());
    await vi.runAllTimersAsync();
    expect(h.write).toHaveBeenCalledTimes(1); // the timer did not write it a second time
    expect(await h.saver.flush()).toEqual(new Set());
    expect(h.write).toHaveBeenCalledTimes(1); // nor did a second flush
  });

  it("the window's close saves what is still waiting for its timer", async () => {
    const h = harness();
    h.saver.edit(draft(A, "Typed, then Alt+F4"), SAVED);
    await savePendingEdits();
    expect(h.disk.get("a")).toBe("Typed, then Alt+F4");
  });

  it("the close never waits forever on a write that never answers", async () => {
    const h = harness("held");
    h.saver.edit(draft(A, "stuck"), SAVED);
    const closing = savePendingEdits(3000);
    let done = false;
    void closing.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(true);
  });
});

describe("overlapping saves", () => {
  it("one write at a time; words typed while one is saving are saved after it, not dropped", async () => {
    const h = harness("held");
    h.saver.edit(draft(A, "One"), SAVED);
    const first = h.saver.flush();
    await settle();
    h.saver.edit(draft(A, "One half"), SAVED); // typed while "One" is on its way
    const second = h.saver.flush();
    await settle();
    expect(h.calls).toHaveLength(1); // the second waits its turn

    h.calls[0].resolve();
    await first;
    await settle();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].draft.content).toBe("One half");
    h.calls[1].resolve();
    await second;
    expect(h.disk.get("a")).toBe("One half");
  });

  it("two flushes of the same words write them once", async () => {
    const h = harness("held");
    h.saver.edit(draft(A, "One"), SAVED);
    const p1 = h.saver.flush();
    const p2 = h.saver.flush();
    await settle();
    h.calls[0].resolve();
    await Promise.all([p1, p2]);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("an undo back to the old words while the new ones are saving still writes the old words after", async () => {
    const h = harness("held");
    h.saver.edit(draft(A, "One"), SAVED);
    const p = h.saver.flush();
    await settle();
    h.saver.edit(draft(A, ""), SAVED); // back to what was on disk before "One" left
    h.calls[0].resolve();
    await p;
    const q = h.saver.flush();
    await settle();
    h.calls[1].resolve();
    await q;
    expect(h.disk.get("a")).toBe("");
  });
});

describe("a save that fails", () => {
  it("keeps the note's words, says which note, and saves them on the next try", async () => {
    const h = harness();
    h.failOnce("error returned from database: (code: 13) database or disk is full");
    h.saver.edit(draft(A, "Half of 4 is 2"), SAVED);
    expect(await h.saver.flush()).toEqual(new Set(["a"]));
    expect(h.events).toEqual(["failed a:Half of 4 is 2"]);
    expect(h.saver.newest("a")).toEqual({ title: "Halves", content: "Half of 4 is 2" });
    expect(h.saver.failure("a")?.title).toBe("Halves");

    expect(await h.saver.flush()).toEqual(new Set()); // Save again
    expect(h.disk.get("a")).toBe("Half of 4 is 2");
    expect(h.saver.failure("a")).toBeUndefined();
  });

  it("only the note that failed is reported; another note's save goes ahead", async () => {
    const h = harness();
    h.failOnce("database is locked");
    h.saver.edit(draft(A, "a words"), SAVED);
    h.saver.edit(draft(B, "b words"), SAVED);
    expect(await h.saver.flush()).toEqual(new Set(["a"]));
    expect(h.disk.get("b")).toBe("b words");
  });

  it("keeps the words even when they were typed back to while the failed save was on its way", async () => {
    const h = harness("held");
    h.saver.edit(draft(A, "One"), SAVED);
    const p = h.saver.flush();
    await settle();
    h.saver.edit(draft(A, "One!"), SAVED);
    h.saver.edit(draft(A, "One"), SAVED); // the same words as the save in flight: nothing new to keep
    h.calls[0].reject("database is locked");
    expect(await p).toEqual(new Set(["a"]));
    expect(h.saver.newest("a")?.content).toBe("One");
    expect(h.saver.failure("a")).toBeDefined();
  });

  it("typing back to what is on disk clears the failure: nothing is unsaved", async () => {
    const h = harness();
    h.failOnce("database is locked");
    h.saver.edit(draft(A, "oops"), SAVED);
    await h.saver.flush();
    h.saver.edit(draft(A, ""), SAVED);
    expect(h.saver.failure("a")).toBeUndefined();
    expect(h.events[h.events.length - 1]).toBe("saved a:");
  });
});

describe("a deleted note", () => {
  it("is never written again, even with words waiting for the timer", async () => {
    const h = harness();
    h.saver.edit(draft(A, "gone soon"), SAVED);
    h.saver.discard("a");
    await vi.runAllTimersAsync();
    await h.saver.flush();
    h.saver.edit(draft(A, "typed after"), SAVED);
    await h.saver.flush();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.saver.newest("a")).toBeUndefined();
  });
});

describe("the newest words", () => {
  it("come from the saver over a stale notes list, so reopening a note never shows older text", async () => {
    const h = harness();
    h.saver.edit(draft(A, "saved while the Notes tab was closed"), SAVED);
    await h.saver.flush();
    expect(h.saver.newest("a")?.content).toBe("saved while the Notes tab was closed");
    // A later edit is judged against what the saver wrote, not the stale list's text.
    h.saver.edit(draft(A, "saved while the Notes tab was closed"), SAVED);
    await h.saver.flush();
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});
