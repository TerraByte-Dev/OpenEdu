import { describe, it, expect } from "vitest";
import { threadSwitchAbortsTurn, turnIsShown, turnLanding } from "./turn-thread";

describe("threadSwitchAbortsTurn", () => {
  it("does nothing when no turn is running", () => {
    expect(threadSwitchAbortsTurn(undefined, "a")).toBe(false);
    expect(threadSwitchAbortsTurn(undefined, null)).toBe(false);
  });

  it("aborts when another thread is opened mid-turn", () => {
    expect(threadSwitchAbortsTurn("a", "b")).toBe(true);
  });

  it("aborts when a new conversation is opened mid-turn", () => {
    expect(threadSwitchAbortsTurn("a", null)).toBe(true);
  });

  it("does not abort when the rail opens the turn's own thread", () => {
    // First send of a new conversation: the send path records the created id, then the rail opens it.
    expect(threadSwitchAbortsTurn("a", "a")).toBe(false);
  });

  it("aborts a new conversation's turn when another thread is opened before its thread exists", () => {
    expect(threadSwitchAbortsTurn(null, "b")).toBe(true);
  });
});

describe("turnIsShown", () => {
  it("is true only for the turn's own thread", () => {
    expect(turnIsShown("a", "a")).toBe(true);
    expect(turnIsShown("a", "b")).toBe(false);
    expect(turnIsShown("a", null)).toBe(false);
    expect(turnIsShown("a", undefined)).toBe(false);
  });
});

describe("turnLanding", () => {
  const base = { turnThread: "a", shownThread: "a", interrupted: false, autoRead: true };

  it("shows and reads a finished reply in its own thread", () => {
    expect(turnLanding(base)).toEqual({ show: true, speak: true });
  });

  it("neither shows nor reads a reply whose thread is no longer shown", () => {
    expect(turnLanding({ ...base, shownThread: "b" })).toEqual({ show: false, speak: false });
    expect(turnLanding({ ...base, shownThread: "b", interrupted: true })).toEqual({ show: false, speak: false });
  });

  it("shows but never reads an interrupted reply, even after switching back to its thread", () => {
    expect(turnLanding({ ...base, interrupted: true })).toEqual({ show: true, speak: false });
  });

  it("does not read when auto-read is off", () => {
    expect(turnLanding({ ...base, autoRead: false })).toEqual({ show: true, speak: false });
  });
});
