import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText, pickVoice } from "./speech";

// The thin window.speechSynthesis shell for read-aloud (#243). What to say and which voice are
// decided in speech.ts (pure, tested); this only plays it. One utterance at a time: starting one
// cancels the last. Uses the OS voices, so it works offline with the built-in Windows voices.

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export interface ReadAloud {
  /** False when the webview has no speechSynthesis: hide the speaker buttons. */
  supported: boolean;
  /** The id of the reply being read, or null. */
  speakingId: string | null;
  speak: (id: string, markdown: string) => void;
  /** Read `id`, or stop if it is the one being read. */
  toggle: (id: string, markdown: string) => void;
  stop: () => void;
}

export function useReadAloud(): ReadAloud {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakingRef = useRef<string | null>(null);
  // Bumped per utterance: a cancelled utterance's late end event must not clear the next one.
  const turnRef = useRef(0);
  // The utterance being spoken. Chromium can garbage-collect an utterance nothing references, and then
  // onend never fires and the button is stuck on "Stop reading" (#246). Held until end, error or stop.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    turnRef.current++;
    synth()?.cancel();
    utteranceRef.current = null;
    speakingRef.current = null;
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, markdown: string) => {
    const s = synth();
    const text = speakableText(markdown);
    if (!s || !text) return;
    s.cancel();
    const turn = ++turnRef.current;
    const u = new SpeechSynthesisUtterance(text);
    const uiLang = document.documentElement.lang || navigator.language || "en";
    const voice = pickVoice(s.getVoices(), uiLang);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    const done = () => {
      if (turnRef.current !== turn) return;
      utteranceRef.current = null;
      speakingRef.current = null;
      setSpeakingId(null);
    };
    u.onend = done;
    u.onerror = done;
    utteranceRef.current = u;
    speakingRef.current = id;
    setSpeakingId(id);
    s.speak(u);
  }, []);

  const toggle = useCallback((id: string, markdown: string) => {
    if (speakingRef.current === id) stop();
    else speak(id, markdown);
  }, [speak, stop]);

  useEffect(() => {
    // Chromium loads the voice list on first ask; asking now means it is there by the first press.
    synth()?.getVoices();
    // Nothing keeps talking after the chat is gone.
    return () => { turnRef.current++; synth()?.cancel(); utteranceRef.current = null; };
  }, []);

  return { supported: synth() !== null, speakingId, speak, toggle, stop };
}
