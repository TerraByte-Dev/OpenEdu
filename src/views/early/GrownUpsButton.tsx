import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LockIcon } from "./pictures";

// The way out of the child's screens (#244): press and hold for HOLD_MS. A tap does nothing but start
// the fill, so a child poking around stays put. Pointer (mouse, touch, pen) and keyboard (hold Space or
// Enter) both work; letting go, or sliding off, before the end cancels.
//
// Assistive technology (#249): a screen reader's "activate" and voice control's "click" send a click
// with no press behind it (detail 0), and they cannot hold. That click opens the grown-ups area at once.
// A finger or mouse click always has detail >= 1, and a keyboard press is held (its own click is
// cancelled below), so neither skips the hold. In a class or school the teacher PIN still asks.

export const HOLD_MS = 2000;

export default function GrownUpsButton({ onHeld }: { onHeld: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  // A key went down on the button: the click a browser may send for Space/Enter is not an AT click.
  const keyed = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const start = () => {
    if (timer.current !== null) return; // key repeat, or a second pointer
    setHolding(true);
    timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onHeld(); }, HOLD_MS);
  };

  const onClick = (e: MouseEvent) => {
    if (e.detail === 0 && !keyed.current) onHeld();
  };

  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      className="early-hold"
      data-holding={holding}
      style={{ ["--hold" as string]: holding ? 1 : 0, ["--hold-ms" as string]: `${HOLD_MS}ms` }}
      aria-label="Grown-ups: press and hold"
      title="Grown-ups: press and hold"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); keyed.current = true; start(); } }}
      onKeyUp={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        cancel();
        // Any click this key sends comes right after keyup; let it pass first.
        window.setTimeout(() => { keyed.current = false; }, 0);
      }}
      onBlur={cancel}
    >
      <LockIcon />
      <span>{holding ? "Keep holding" : "Grown-ups"}</span>
    </button>
  );
}
