import { describe, it, expect } from "vitest";
import { pinKeyAction } from "./pin-pad";

// LearnerPicker's PinScreen hands every window keydown to pinKeyAction, with onControl from PIN_CONTROLS.
// That wiring, with clicks and Tab focus, is tested through the real PinScreen in components/pin-screen.test.ts.
describe("pinKeyAction", () => {
  it("types digits and deletes with Backspace wherever focus is", () => {
    for (const onControl of [false, true]) {
      expect(pinKeyAction("7", onControl)).toBe("7");
      expect(pinKeyAction("0", onControl)).toBe("0");
      expect(pinKeyAction("Backspace", onControl)).toBe("back");
    }
  });

  it("opens on Enter only when focus is not on a control", () => {
    expect(pinKeyAction("Enter", false)).toBe("submit");
    // Enter on a focused pad key, C, Delete, Back or Open: that button's own click only.
    expect(pinKeyAction("Enter", true)).toBeNull();
  });

  it("leaves on Escape and ignores other keys", () => {
    expect(pinKeyAction("Escape", true)).toBe("leave");
    expect(pinKeyAction("Escape", false)).toBe("leave");
    for (const k of ["a", " ", "Tab", "12", "F5"]) expect(pinKeyAction(k, false)).toBeNull();
  });
});
