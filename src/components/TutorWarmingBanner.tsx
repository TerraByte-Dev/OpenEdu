// Shown while something the learner asked for (a course build, a chat reply, quiz grading) waits for
// Ollama to load the model (llm.ts warmOllamaModel). On a CPU-only computer the first load after it
// starts up took 88 s, and a screen that sits still that long reads as broken.

import { useEffect, useState } from "react";
import { isWaitingForTutorLoad, onTutorLoadWait } from "../lib/llm";
import { TUTOR_WARMING_UP } from "../lib/plain-language";

export default function TutorWarmingBanner() {
  const [waiting, setWaiting] = useState(isWaitingForTutorLoad);
  useEffect(() => onTutorLoadWait(setWaiting), []);
  if (!waiting) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 px-4 py-2 border-b border-[var(--rule)] text-sm text-phosphor-ink shrink-0"
      style={{ background: "rgb(var(--phosphor-rgb)/0.04)" }}
    >
      <span className="w-2 h-2 rounded-full bg-phosphor animate-pulse shrink-0" />
      <span>{TUTOR_WARMING_UP}</span>
    </div>
  );
}
