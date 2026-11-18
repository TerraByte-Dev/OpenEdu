// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The real PinScreen (LearnerPicker.tsx) with the real PBKDF2 check: its window keydown wiring
// (pin-pad.ts PIN_CONTROLS + pinKeyAction) and the pad keys' pointer handling, which together decide
// whether Enter opens or presses a key. verifyPin is only wrapped to count the checks. jsdom does not
// move focus on mousedown or click a focused button on Enter, so pointerPress/pressEnter below do what
// Chromium (WebView2) does.

vi.mock("../lib/learner-pin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/learner-pin")>();
  return { ...real, verifyPin: vi.fn(real.verifyPin) };
});

const { PinScreen } = await import("./LearnerPicker");
const { hashPin, verifyPin } = await import("../lib/learner-pin");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let onUnlocked: ReturnType<typeof vi.fn>;
let onBack: ReturnType<typeof vi.fn>;
const record = await hashPin("12345", 100_000);

beforeEach(async () => {
  vi.mocked(verifyPin).mockClear();
  onUnlocked = vi.fn();
  onBack = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(PinScreen, { name: "Ada", record, onBack, onUnlocked }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const key = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const typed = () => host.querySelector('[aria-label$="digits typed"]')!.getAttribute("aria-label");
const checks = () => vi.mocked(verifyPin).mock.calls.length;

/** A mouse click or touch tap: Chromium focuses the button on mousedown unless that is prevented. */
async function pointerPress(label: string) {
  await act(async () => {
    const b = key(label);
    if (b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))) b.focus();
    b.click();
  });
}

/**
 * Enter on the keyboard: a keydown at the focused element, then, if that is a button, its click. When
 * that started a PIN check, waits (inside act) for the check to finish.
 */
async function pressEnter() {
  await act(async () => {
    const before = checks();
    const at = (document.activeElement ?? document.body) as HTMLElement;
    const go = at.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    if (go && at instanceof HTMLButtonElement) at.click();
    if (checks() > before) {
      const pending = vi.mocked(verifyPin).mock.results.slice(before).map((r) => r.value);
      await Promise.all(pending);
    }
  });
}

describe("PinScreen keyboard + pointer", () => {
  it("clicking the keys and then pressing Enter opens with the clicked PIN", async () => {
    for (const d of ["1", "2", "3", "4", "5"]) await pointerPress(d);
    expect(typed()).toBe("5 digits typed");
    await pressEnter();
    expect(checks()).toBe(1);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("Enter on a Tab-focused pad key presses that key and does not submit the first 4 digits", async () => {
    for (const d of ["1", "2", "3", "4"]) await pointerPress(d);
    key("5").focus();
    await pressEnter();
    expect(typed()).toBe("5 digits typed");
    expect(checks()).toBe(0);
    expect(host.textContent).not.toContain("That PIN is not right");
  });

  it("Enter on a focused Back goes back and does not open, even with the right PIN typed", async () => {
    for (const d of ["1", "2", "3", "4", "5"]) await pointerPress(d);
    button("Back").focus();
    await pressEnter();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(checks()).toBe(0);
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("Enter on a focused Open checks the PIN once", async () => {
    for (const d of ["1", "2", "3", "4", "5"]) await pointerPress(d);
    button("Open").focus();
    await pressEnter();
    expect(checks()).toBe(1);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it("typed digits and Enter open from the keyboard alone", async () => {
    await act(async () => {
      for (const d of "12345") window.dispatchEvent(new KeyboardEvent("keydown", { key: d, bubbles: true }));
    });
    await pressEnter();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });
});
