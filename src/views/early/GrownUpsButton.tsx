import { useEffect, useRef, useState } from "react";
import { LockIcon } from "./pictures";

// The way out of the child's screens (#244): press and hold for HOLD_MS. A tap does nothing but start
// the fill, so a child poking around stays put. Pointer (mouse, touch, pen) and keyboard (hold Space or
// Enter) both work; letting go, or sliding off, before the end cancels.

export const HOLD_MS = 2000;

export default function GrownUpsButton({ onHeld }: { onHeld: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);

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
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") cancel(); }}
      onBlur={cancel}
    >
      <LockIcon />
      <span>{holding ? "Keep holding" : "Grown-ups"}</span>
    </button>
  );
}
