import { describe, it, expect } from "vitest";
import { transcriptLoader } from "./thread-transcript";

const rows: Record<string, string[]> = { a: ["a1", "a2"], b: ["b1"], t: ["t-old"] };

function setup() {
  const shown: string[][] = [];
  const fetches: string[] = [];
  const loader = transcriptLoader(
    async (id: string) => { fetches.push(id); return rows[id] ?? []; },
    (msgs) => { shown.push(msgs); },
  );
  return { loader, shown, fetches };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("transcriptLoader", () => {
  it("shows a thread's saved messages", async () => {
    const { loader, shown } = setup();
    loader.open("a");
    await settle();
    expect(shown[shown.length - 1]).toEqual(["a1", "a2"]);
    expect(loader.shown()).toBe("a");
  });

  it("still shows the messages when the effect is cleaned up and re-run before they land (#270)", async () => {
    // React StrictMode mounts, cleans up and re-runs every effect. ChatTab mounting with a thread
    // already selected (opening the Chat tab after the rail has loaded) dropped the first load and
    // skipped the second, leaving "Start chatting with your tutor" over a saved conversation.
    const { loader, shown } = setup();
    const cleanup = loader.open("a");
    cleanup();
    loader.open("a");
    await settle();
    expect(shown[shown.length - 1]).toEqual(["a1", "a2"]);
  });

  it("drops a load overtaken by a switch to another thread", async () => {
    const { loader, shown } = setup();
    const cleanup = loader.open("a");
    cleanup();
    loader.open("b");
    await settle();
    expect(shown).toEqual([["b1"]]);
    expect(loader.shown()).toBe("b");
  });

  it("shows an empty transcript for a new conversation, at once", () => {
    const { loader, shown, fetches } = setup();
    loader.open(null);
    expect(shown).toEqual([[]]);
    expect(fetches).toEqual([]);
    expect(loader.shown()).toBe(null);
  });

  it("does not re-fetch a thread the send path created and claimed", async () => {
    const { loader, shown, fetches } = setup();
    const cleanup = loader.open(null);
    loader.claim("t"); // first send created thread t; the send path holds its messages
    cleanup();
    loader.open("t"); // the rail follows into the new thread
    await settle();
    expect(fetches).toEqual([]);
    expect(shown).toEqual([[]]);
    expect(loader.shown()).toBe("t");
  });

  it("does not re-fetch a thread whose messages already landed", async () => {
    const { loader, fetches } = setup();
    const cleanup = loader.open("a");
    await settle();
    cleanup();
    loader.open("a");
    await settle();
    expect(fetches).toEqual(["a"]);
  });
});
