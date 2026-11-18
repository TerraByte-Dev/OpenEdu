import { useEffect } from "react";
import { useReadAloud } from "../lib/useReadAloud";
import { IconMediaStop, IconVolumeUp } from "./icons";

// The chat's speaker button (ChatTab, .speak-btn) for text outside the chat: a lesson in the reader and a
// quiz or level-test question (speech.ts questionSpeech). `text` is markdown, read through speakableText
// like a tutor reply. New text (the next question) stops the last; so does leaving the screen.

export default function ReadAloudButton({ text }: { text: string }) {
  const read = useReadAloud();
  const { stop } = read;
  useEffect(() => stop, [text, stop]);
  if (!read.supported) return null;
  const reading = read.speakingId !== null;
  const label = reading ? "Stop reading" : "Read aloud";
  return (
    <button type="button" className="speak-btn" onClick={() => read.toggle("text", text)} aria-label={label} aria-pressed={reading} title={label}>
      {reading ? <IconMediaStop size={16} className="scale-[0.65]" /> : <IconVolumeUp size={18} />}
    </button>
  );
}
