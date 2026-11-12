import { describe, it, expect } from "vitest";
import { recordVoice } from "./voice";

describe("recordVoice", () => {
  it.each([
    [null, 0, "guided"],
    [null, 8, "guided"],
    [null, 9, "self"],
    [null, 12, "self"],
    [null, null, "ask"],
    ["self", 2, "self"],
    ["guided", 11, "guided"],
    ["guided", null, "guided"],
    ["teacher", null, "ask"],
  ] as const)("stored %j, grade %j → %s", (stored, grade, voice) => {
    expect(recordVoice({ stored, grade })).toBe(voice);
  });
});
