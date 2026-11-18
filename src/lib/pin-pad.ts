// The PIN pad's keyboard (components/LearnerPicker.tsx PinScreen). Pure, tested in pin-pad.test.ts.
//
// Digits and Backspace type on the pad wherever focus is. Enter opens (submits the PIN) only when focus
// is not on a control: Enter on a focused pad key, C, Delete, Back or Open is that control's own press,
// and the window must not also submit the digits typed so far. Before this, Tab and Enter through a 5- or
// 6-digit PIN submitted its first 4 digits as a wrong try and cleared the pad, and Enter on Back with the
// right PIN typed opened the learner instead of going back. A click or tap on a pad key keeps focus where
// it was (the keys' onMouseDown), so Enter after clicking 1-2-3-4 still opens rather than pressing the
// last-clicked key again; components/pin-screen.test.ts runs both through PinScreen.

export type PinKey = "back" | "submit" | "leave" | `${number}`;

/** What a key pressed on the PIN screen does, or null for nothing. `onControl`: focus is on a button or other control. */
export function pinKeyAction(key: string, onControl: boolean): PinKey | null {
  if (/^\d$/.test(key)) return key as PinKey;
  if (key === "Backspace") return "back";
  if (key === "Enter") return onControl ? null : "submit";
  if (key === "Escape") return "leave";
  return null;
}

/** The elements whose own Enter press pinKeyAction leaves alone. */
export const PIN_CONTROLS = "button, a[href], input, textarea, select, [role='button']";
