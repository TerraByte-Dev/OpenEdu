import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderChatMarkdown, ensureChatKatex } from "../lib/chat-markdown";
import { AI_DISCLOSURE } from "../lib/ai-notice";
import { useReadAloud } from "../lib/useReadAloud";
import { log } from "../lib/llm";
import {
  HAND_WORDS, KIND_HEADINGS, handStep, moreChoices,
  type HandEvent, type HandState, type HelpSurface, type LessonHelp,
} from "../lib/raise-hand";
import { IconXmark } from "./icons";

// "Raise hand" (src/lib/raise-hand.ts): a button, and a small panel where the tutor offers tappable help.
// There is no text box. Tapping reads help stored with the lesson; the only model call is writing it the
// first time for a lesson made before Raise hand (`load`). "Did this help?" answers live in this
// component's state only.

export interface HandTarget { id: string; title: string }

interface RaiseHandProps {
  surface: HelpSurface;
  /** The subtopics the learner could be stuck on. One: asked about directly; several: "Which part?" first. */
  targets: HandTarget[];
  load: (targetId: string) => Promise<LessonHelp | null>;
  /** Opens the normal chat, its box filled in for that subtopic. */
  onTypeToTutor: (target: HandTarget | null) => void;
}

// Big, plain tap targets for young learners. Inline because .btn's unlayered size beats Tailwind's.
const BIG = { minHeight: 56, fontSize: "1.0625rem" } as const;

export default function RaiseHand({ surface, targets, load, onTypeToTutor }: RaiseHandProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<HandTarget | null>(null);
  const [help, setHelp] = useState<LessonHelp | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "none">("idle");
  const [hand, setHand] = useState<HandState>({ at: "pick" });
  const read = useReadAloud();
  // Help already loaded this time the panel's subtopics are on screen, so raising a hand again (or
  // after an older lesson's help was just written) does not load or write it twice.
  const loaded = useRef(new Map<string, LessonHelp>());
  // Bumped on every load and close, so a slow load that finishes late never replaces a newer one.
  const turn = useRef(0);

  const choose = async (t: HandTarget) => {
    const mine = ++turn.current;
    setTarget(t);
    setHand({ at: "pick" });
    setStatus("loading");
    try {
      const h = loaded.current.get(t.id) ?? await load(t.id);
      if (h) loaded.current.set(t.id, h);
      if (mine !== turn.current) return;
      setHelp(h);
      setStatus(h ? "ready" : "none");
    } catch (e) {
      log.warn("RaiseHand", "help could not be loaded", e instanceof Error ? e.message : String(e));
      if (mine !== turn.current) return;
      setHelp(null);
      setStatus("none");
    }
  };

  const raise = () => {
    setOpen(true);
    if (targets.length === 1) void choose(targets[0]);
    else { setTarget(null); setStatus("idle"); }
  };
  const close = () => { turn.current++; read.stop(); setOpen(false); setHand({ at: "pick" }); };
  const go = (e: HandEvent) => { read.stop(); setHand((s) => handStep(s, e, surface)); };

  useEffect(() => { if (open) void ensureChatKatex(); }, [open]);
  // Another lesson, or a card on another subtopic, closes the panel.
  const targetKey = targets.map((t) => t.id).join("|");
  useEffect(() => { close(); loaded.current.clear(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [targetKey]);

  const shown = hand.at === "help" && help ? help.stuck_points[hand.point] : null;
  const kind = hand.at === "help" ? hand.tried[hand.tried.length - 1] : null;
  const material = shown && kind ? `${KIND_HEADINGS[kind]}\n\n${shown[kind]}` : "";
  const html = useMemo(() => (material ? renderChatMarkdown(material) : ""), [material]);

  if (!targets.length) return null;

  if (!open) {
    return (
      <button type="button" onClick={raise} className="btn" style={BIG}>
        <span aria-hidden="true">✋</span> {HAND_WORDS.button}
      </button>
    );
  }

  const typeButton = (
    <button type="button" className="btn w-full" style={BIG} onClick={() => { close(); onTypeToTutor(target); }}>
      {HAND_WORDS.typeToTutor}
    </button>
  );

  let body: ReactNode;
  if (!target) {
    body = (
      <>
        <p className="text-lg text-ink">{HAND_WORDS.whichPart}</p>
        {targets.map((t) => (
          <button key={t.id} type="button" className="btn w-full" style={BIG} onClick={() => void choose(t)}>{t.title}</button>
        ))}
      </>
    );
  } else if (status === "loading") {
    body = <p className="text-lg text-ink" role="status">{HAND_WORDS.loading}</p>;
  } else if (status === "none" || !help) {
    body = (
      <>
        <p className="text-lg text-ink">{HAND_WORDS.unavailable}</p>
        {typeButton}
      </>
    );
  } else if (hand.at === "pick") {
    body = (
      <>
        <p className="text-lg text-ink">{HAND_WORDS.pick}</p>
        {help.stuck_points.map((p, i) => (
          <button key={i} type="button" className="btn w-full" style={BIG} onClick={() => go({ type: "pick", point: i })}>{p.label}</button>
        ))}
        <button type="button" className="btn w-full" style={BIG} onClick={() => go({ type: "something_else" })}>{HAND_WORDS.somethingElse}</button>
      </>
    );
  } else if (hand.at === "help") {
    body = (
      <>
        <article className="note-prose text-base" dangerouslySetInnerHTML={{ __html: html }} />
        {read.supported && (
          <button type="button" className="btn self-start" onClick={() => read.toggle("raise-hand", material)}>
            {read.speakingId === "raise-hand" ? HAND_WORDS.stopReading : HAND_WORDS.readToMe}
          </button>
        )}
        <p className="text-lg text-ink">{HAND_WORDS.didItHelp}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-primary btn" style={BIG} onClick={() => go({ type: "yes" })}>{HAND_WORDS.yes}</button>
          <button type="button" className="btn" style={BIG} onClick={() => go({ type: "no" })}>{HAND_WORDS.no}</button>
        </div>
      </>
    );
  } else if (hand.at === "helped") {
    body = (
      <>
        <p className="text-lg text-ink">{HAND_WORDS.helped}</p>
        <button type="button" className="btn w-full" style={BIG} onClick={() => go({ type: "again" })}>{HAND_WORDS.stuckAgain}</button>
        <button type="button" className="btn-primary btn w-full" style={BIG} onClick={close}>{HAND_WORDS.close}</button>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-lg text-ink">{HAND_WORDS.more}</p>
        {moreChoices(hand, surface, false).map((c) =>
          c === "one_more" ? (
            <button key={c} type="button" className="btn w-full" style={BIG} onClick={() => go({ type: "one_more" })}>{HAND_WORDS.oneMore}</button>
          ) : c === "type_to_tutor" ? <div key={c}>{typeButton}</div> : null,
        )}
      </>
    );
  }

  return (
    <>
      <button type="button" className="btn" style={BIG} disabled>
        <span aria-hidden="true">✋</span> {HAND_WORDS.button}
      </button>
      <section
        role="dialog"
        aria-label={HAND_WORDS.title}
        className="fixed bottom-6 right-6 z-40 flex flex-col w-[min(26rem,calc(100vw-3rem))] max-h-[75vh] rounded-[20px] border border-[var(--rule)] bg-panel shadow-[var(--shadow-soft)]"
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-[var(--rule)]">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{HAND_WORDS.title}</h2>
            <p className="text-sm text-[var(--ink-dim)]">{AI_DISCLOSURE}</p>
          </div>
          <button type="button" onClick={close} aria-label={HAND_WORDS.close} className="p-3 rounded-full hover:bg-panel-lite text-[var(--ink-faint)] hover:text-ink">
            <IconXmark size={20} />
          </button>
        </header>
        <div className="flex flex-col gap-3 px-5 py-4 overflow-y-auto">{body}</div>
      </section>
    </>
  );
}
