// Sprite-tutor persona registry (Phase 4b, V2_ARCHITECTURE.md §6.5).
//
// The WHO axis: a curated set of robot-themed pixel headshots, picked per course. A persona is a
// THIN layer — it overrides only the system prompt's identity slot (name + tone); pedagogy lives on
// the orthogonal mode (HOW) and domain (WHAT) axes. The matching voice rides in the
// sprite-persona-<id>.md skill body (loaded by the skills glob); this registry is the UI/art side:
// id, display name, headshot, blurb, and subject hints used only to *suggest* a default in the picker.
//
// Art is referenced by imported asset URL (Vite hashes + bundles the PNG), so swapping the artwork
// later is a drop-in file replacement with no code change. All sprites are 128x128 transparent PNGs.

import sageUrl from "../../assets/sprites/sage.png";
import eulerUrl from "../../assets/sprites/euler.png";
import adaUrl from "../../assets/sprites/ada.png";
import lingoUrl from "../../assets/sprites/lingo.png";
import novaUrl from "../../assets/sprites/nova.png";

export interface SpritePersona {
  id: string;
  displayName: string;
  imagePath: string;
  blurb: string;
  // Lowercased subject keywords; a case-insensitive substring match against the course topic lets
  // the create-course picker SUGGEST a fitting persona. Never binding — any persona teaches anything.
  domainHints: string[];
}

// The neutral default — pre-selected in the picker, and the conventional "any subject" tutor.
export const DEFAULT_SPRITE_ID = "sage";

export const SPRITE_PERSONAS: SpritePersona[] = [
  {
    id: "sage",
    displayName: "SAGE",
    imagePath: sageUrl,
    blurb: "Warm, patient generalist — a friendly guide for any subject.",
    domainHints: [],
  },
  {
    id: "euler",
    displayName: "EULER",
    imagePath: eulerUrl,
    blurb: "Precise and methodical — loves clean derivations. Math, physics & engineering.",
    domainHints: ["math", "algebra", "calculus", "geometry", "trigonometry", "statistics", "physics", "engineering"],
  },
  {
    id: "ada",
    displayName: "ADA-9",
    imagePath: adaUrl,
    blurb: "Sharp, witty, debugging-minded. Computer science & code.",
    domainHints: ["programming", "coding", "code", "computer science", "python", "javascript", "software", "algorithm"],
  },
  {
    id: "lingo",
    displayName: "LINGO-3",
    imagePath: lingoUrl,
    blurb: "Chatty and encouraging — patient with practice. Languages.",
    domainHints: ["language", "spanish", "french", "german", "japanese", "english", "grammar", "vocabulary", "linguistics"],
  },
  {
    id: "nova",
    displayName: "NOVA",
    imagePath: novaUrl,
    blurb: "Curious and experimental — excited by phenomena. Chemistry, biology & science.",
    domainHints: ["science", "chemistry", "biology", "astronomy", "geology", "ecology", "anatomy"],
  },
];

const BY_ID = new Map(SPRITE_PERSONAS.map((p) => [p.id, p]));

export function getSpritePersona(id: string | null | undefined): SpritePersona | undefined {
  return id ? BY_ID.get(id) : undefined;
}

// Suggest a persona whose domain hints appear in the topic (first match wins). Returns undefined
// when nothing matches — the picker then leaves SAGE (the default) selected.
export function suggestSpriteForTopic(topic: string): SpritePersona | undefined {
  const t = topic.toLowerCase();
  return SPRITE_PERSONAS.find((p) => p.domainHints.some((kw) => t.includes(kw)));
}
