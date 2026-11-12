import { useEffect } from "react";
import { APP_NAME } from "../lib/product";

// A quiet launch moment, nothing more: the name on paper for half a second. It used to be a 3.7 s fake
// BIOS log ("POST... PASS", "[ OK ] Promotion test engine ARMED") that a kid read as the computer being
// broken and a parent read as a hacker toy — and it ran, unskippable, on every launch of a shared PC.
// (#92 had already removed the environment claims; this removes the register.)
//
// Nothing here checks anything. Everything about the ENVIRONMENT lives in SetupGate, which actually
// probes. Do not add status lines back: this screen is gone before any probe could answer.
const BRAND_MS = 550;

interface BootSequenceProps {
  onComplete: () => void;
}

export default function BootSequence({ onComplete }: BootSequenceProps) {
  useEffect(() => {
    const id = setTimeout(onComplete, BRAND_MS);
    return () => clearTimeout(id);
  }, [onComplete]);

  return (
    <div className="brand-splash" aria-hidden="true">
      <span className="brand-splash-name">{APP_NAME}</span>
    </div>
  );
}
