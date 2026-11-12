import { useEffect, useState } from "react";
import { needsPin, type LearnerRow } from "../lib/learners";
import { verifyPin } from "../lib/learner-pin";
import RestoreSteps from "./RestoreSteps";
import { APP_NAME } from "../lib/product";

// "Who is learning?" OpenEdu is for one learner, so a new install never sees this. It is shown at
// launch only when learners.ts needsPicker() says so: an install that added learners in an earlier
// version (or put a PIN on its only learner), and after "Switch learner". Every learner on the
// computer is listed, and a learner with a PIN is entered only through PinScreen. Big tiles, big
// names, a big number pad. No learner data is loaded until a learner is entered.

interface LearnerPickerProps {
  learners: LearnerRow[];
  onEnter: (learner: LearnerRow) => void;
}

// .btn is unlayered CSS, so Tailwind size/padding utilities lose to it (docs/ARCHITECTURE.md). Size
// buttons inline instead.
export const BIG_BTN: React.CSSProperties = { fontSize: "1.15rem", padding: "12px 24px" };
const PAD_BTN: React.CSSProperties = { fontSize: "1.6rem", width: 96, height: 64, justifyContent: "center" };

const TILE = "flex flex-col items-center justify-center gap-3 w-44 h-44 rounded-xl border border-[var(--rule)] bg-panel hover:border-[var(--phosphor)] hover:bg-[rgb(var(--phosphor-rgb)/0.06)] transition-colors";

export default function LearnerPicker({ learners, onEnter }: LearnerPickerProps) {
  const [pinFor, setPinFor] = useState<LearnerRow | null>(null);

  if (pinFor) {
    return <PinScreen name={pinFor.name} record={pinFor} onBack={() => setPinFor(null)} onUnlocked={() => onEnter(pinFor)} />;
  }

  // Only reachable by editing the database by hand: the app never deletes the last learner. Say so
  // rather than show an empty picker with nothing to press.
  if (learners.length === 0) {
    return (
      <div role="alert" className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-5 p-8 bg-bg">
        <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          No learner found
        </h1>
        <p className="text-lg text-[var(--ink-dim)] max-w-prose text-center">
          {APP_NAME}'s data file has no learner in it, so there is nobody to open. Restore a backup like this.
          With no backup, do steps 1 to 3 and start {APP_NAME} again: it begins with a new, empty file.
        </p>
        <RestoreSteps />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-8 p-8 bg-bg">
      <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>
        Who is learning?
      </h1>
      <div className="flex flex-wrap justify-center gap-5 max-w-4xl">
        {learners.map((l) => (
          <button
            key={l.id}
            className={TILE}
            onClick={() => (needsPin(l) ? setPinFor(l) : onEnter(l))}
          >
            <Initial name={l.name} />
            <span className="text-xl text-ink text-center px-2 break-words max-w-full" style={{ fontFamily: "var(--font-display)" }}>
              {l.name}
            </span>
            {needsPin(l) && <span className="text-base text-[var(--ink-dim)]">PIN</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Initial({ name }: { name: string }) {
  return (
    <span
      className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-phosphor border border-[var(--phosphor)]"
      style={{ background: "rgb(var(--phosphor-rgb)/0.10)", fontFamily: "var(--font-display)" }}
      aria-hidden
    >
      {(name.trim()[0] ?? "?").toLocaleUpperCase()}
    </span>
  );
}

const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

/** The big number pad for a learner's PIN. */
function PinScreen({ name, record, onBack, onUnlocked }: {
  name: string;
  record: { pin_hash: string | null; pin_salt: string | null };
  onBack: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = (k: string) => {
    if (busy) return;
    setWrong(false);
    if (k === "clear") setPin("");
    else if (k === "back") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 6 ? p + k : p));
  };

  const submit = async () => {
    if (busy || pin.length < 4) return;
    setBusy(true);
    const ok = await verifyPin(pin, record);
    setBusy(false);
    if (ok) { onUnlocked(); return; }
    setPin("");
    setWrong(true);
  };

  // Typing digits on a keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-6 p-8 bg-bg">
      <Initial name={name} />
      <h1 className="text-3xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>{name}</h1>
      <p className="text-xl text-[var(--ink-dim)]">Type your PIN</p>
      <div className="flex gap-3 h-6 items-center" aria-label={`${pin.length} digits typed`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={`w-5 h-5 rounded-full border border-[var(--phosphor)] ${i < pin.length ? "bg-phosphor" : ""}`} />
        ))}
      </div>
      <p className="text-lg text-danger h-7">{wrong ? "That PIN is not right. Try again." : busy ? "Checking…" : ""}</p>
      <div className="grid grid-cols-3 gap-3">
        {PAD_KEYS.map((k) => (
          <button
            key={k}
            className="btn"
            style={PAD_BTN}
            onClick={() => press(k)}
            aria-label={k === "back" ? "Delete last digit" : k === "clear" ? "Clear" : k}
          >
            {k === "back" ? "⌫" : k === "clear" ? "C" : k}
          </button>
        ))}
      </div>
      <div className="flex gap-4">
        <button className="btn" style={BIG_BTN} onClick={onBack}>Back</button>
        <button className="btn btn-primary" style={BIG_BTN} disabled={busy || pin.length < 4} onClick={() => void submit()}>
          Open
        </button>
      </div>
    </div>
  );
}
