import { SAFETY_NOTICE } from "../lib/child-safety";
import { useReadAloud } from "../lib/useReadAloud";
import { IconMediaStop, IconVolumeUp } from "./icons";

// The chat's fixed SAFETY_NOTICE (child-safety.ts), with a speaker button so a learner who cannot read it can
// hear it, as under a chat message. Shown where a learner's typed words outside the chat read as a safety
// disclosure: a quiz or level-test written answer, "why is that the answer?", the new-course topic, a Notebook
// note, search, folder name or import, a new card and a learner's name.
// Code-matched by the caller (isSafetyDisclosure with the learner's grade), never a model call. Ported from
// TerraTutor #175. The notice itself never blocks: the caller decides whether the words are also refused (a
// learner's name, a folder name, a search, a card) or kept (TerraTutor #237).

// `large`: K-2 (grade.ts isEarlyReader) reads it at the chat's larger size (.chat-text-large, 1.25rem), as the
// same notice reads in the chat, instead of 14px beside a text-xl quiz (ported from TerraTutor #231).
export default function SafetyNotice({ className = "", large = false }: { className?: string; large?: boolean }) {
  const readAloud = useReadAloud();
  const reading = readAloud.speakingId === "safety";
  return (
    <div role="note" className={`flex items-start gap-3 p-3 rounded-lg border border-warning/40 border-l-4 border-l-warning bg-warning-tint ${large ? "text-xl" : "text-sm"} text-ink leading-relaxed ${className}`}>
      <p className="flex-1">{SAFETY_NOTICE}</p>
      {readAloud.supported && (
        <button
          type="button"
          className="speak-btn"
          onClick={() => readAloud.toggle("safety", SAFETY_NOTICE)}
          aria-label={reading ? "Stop reading" : "Read aloud"}
          aria-pressed={reading}
          title={reading ? "Stop reading" : "Read aloud"}
        >
          {reading ? <IconMediaStop size={16} className="scale-[0.65]" /> : <IconVolumeUp size={18} />}
        </button>
      )}
    </div>
  );
}
