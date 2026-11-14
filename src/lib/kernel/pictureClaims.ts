// A reply that says it shows a picture and shows none (docs/ARCHITECTURE.md, "Claims a reply may not
// make"). Click test 2026-11-14: asked to draw a pizza cut into 4 slices, the tutor wrote "Here is a
// picture of a pizza cut into 4 equal slices." and drew nothing. A small model writes the words that
// usually come before a picture whether or not it made one. Code can see whether one is there.
//
// Read on the finished reply, once, because the picture often comes after the sentence that points at
// it ("Here is a diagram:" and then a ```mermaid fence). If the reply shows nothing that draws
// (showsPicture), each sentence that says a picture is shown is taken out, and the first one's place
// takes DRAW_OFFER, unless the reply already offers to draw. What a claim sentence says after a colon
// stays ("I've drawn the water cycle: water evaporates..." keeps the description). Questions, offers,
// instructions to the student and conditions ("Want me to draw it?", "Draw 3 groups of 4.", "If I drew
// a diagram, ...") are not claims. A reply with no claim comes back byte for byte. Same approach as the
// claim filter in replyClaims.ts, but after the stream: the streamed text still showed the claim, and
// the saved reply, which takes its place on screen when the turn ends, does not.
//
// Known limits: a claim worded outside these patterns gets through; English only.

import { splitReplyDiagrams } from "../mermaid-source";

/** What takes the place of the first claim removed. */
export const DRAW_OFFER = "Want me to draw it?";

const NOUN = String.raw`(?:pictures?|pics?|diagrams?|drawings?|images?|illustrations?|sketch(?:es)?|figures?|charts?|graphs?)`;
const WORDS = (n: number) => String.raw`(?:[\w’'/-]+\s+){0,${n}}?`;
const CLAIMS: ReadonlyArray<RegExp> = [
  // "Here is a picture of …", "Here's a quick sketch", "Here are some diagrams".
  new RegExp(String.raw`\bhere(?:['’]s|\s+is|\s+are)\s+(?:(?:a|an|the|my|this|some|your)\s+)?${WORDS(3)}${NOUN}\b`, "i"),
  // "Below is a diagram", "Above is the picture".
  new RegExp(String.raw`\b(?:below|above)\s+(?:is|are)\s+(?:a|an|the|my|some)\s+${WORDS(3)}${NOUN}\b`, "i"),
  // "I've drawn a diagram", "I drew you a picture", "I have made a simple chart".
  new RegExp(String.raw`\bi(?:['’]ve|\s+have)?\s+(?:just\s+)?(?:drawn|drew|made|created|sketched|included|added)\s+(?:you\s+)?(?:a|an|the|this|some)\s+${WORDS(3)}${NOUN}\b`, "i"),
  // "Look at the picture below", "The diagram above shows", "this picture shows".
  new RegExp(String.raw`\b(?:the|this|my)\s+${WORDS(2)}${NOUN}\s+(?:below|above)\b`, "i"),
  new RegExp(String.raw`\bthis\s+${NOUN}\s+(?:shows|has|illustrates)\b`, "i"),
  // "Let me draw it for you." A promise of a picture, kept or not by what follows.
  /\blet me\s+(?:draw|sketch)\b/i,
];
/** Before the claim in its sentence: a condition or something imagined, not a claim. */
const NOT_A_CLAIM_BEFORE = /\b(?:if|imagine|pretend|suppose|when|once|could|would|can you|try)\b/i;
/** The reply already offers a picture. */
const OFFERS = /\b(?:want me to|should i|shall i|can i|i can|would you like me to|do you want me to)\s+(?:draw|sketch|make)\b/i;

const plainOf = (s: string) => s.replace(/`[^`\n]*`/g, " ").replace(/[*_~]/g, "");

function claims(sentence: string): boolean {
  const plain = plainOf(sentence).trim();
  if (/\?[\s"'”’)]*$/.test(plain)) return false;
  return CLAIMS.some((re) => {
    const m = re.exec(plain);
    return !!m && !NOT_A_CLAIM_BEFORE.test(plain.slice(0, m.index));
  });
}

/**
 * True when the turn shows something drawn: a diagram.render call that ran, a Mermaid diagram in the
 * reply (fenced or bare, as the chat draws it), any fenced block (a text drawing), an inline SVG, a
 * markdown table, a local or data: image (remote ones are blocked, #284), or a row of two or more emoji.
 */
export function showsPicture(text: string, toolCalls: ReadonlyArray<{ name: string; ok: boolean }>): boolean {
  if (toolCalls.some((c) => c.name === "diagram.render" && c.ok)) return true;
  if (splitReplyDiagrams(text).some((s) => s.kind === "mermaid")) return true;
  if (/^ {0,3}(?:`{3,}|~{3,})/m.test(text)) return true;
  if (/<svg[\s>]/i.test(text)) return true;
  if (/^[ \t]*\|.*\|[ \t]*\n[ \t]*\|?[ \t]*:?-{3,}/m.test(text)) return true;
  if (/!\[[^\]]*\]\(\s*(?!https?:|\/\/)[^)\s]+/i.test(text)) return true;
  return /(?:\p{Extended_Pictographic}️?\s?){2,}/u.test(text);
}

const BLOCK_MARKER = /^[ \t]*(?:[-*+•][ \t]+|\d+[.)][ \t]+|>[ \t]*|#{1,6}[ \t]+)/;
const SENTENCE = /[^.!?]*(?:[.!?]+["'”’)\]*_]*|$)\s*/g;
const capitalize = (s: string) => s.replace(/^([*_\s"“]*)(\p{Ll})/u, (_, pre: string, c: string) => pre + c.toUpperCase());

/** `text` with each sentence that says a picture is shown taken out, the first replaced by DRAW_OFFER. */
export function withoutPictureClaims(text: string): string {
  let offer = !OFFERS.test(plainOf(text));
  let changed = false;
  const lines = text.split("\n").map((line) => {
    const marker = BLOCK_MARKER.exec(line)?.[0] ?? "";
    const body = line.slice(marker.length);
    const sentences = body.match(SENTENCE)?.filter((s) => s) ?? [];
    if (!sentences.some(claims)) return line;
    changed = true;
    const kept: string[] = [];
    for (const raw of sentences) {
      const s = raw.trim();
      if (!claims(s)) { kept.push(s); continue; }
      const colon = s.indexOf(": ");
      const rest = colon >= 0 ? s.slice(colon + 2).trim() : "";
      const said = /[\p{L}\p{N}]/u.test(rest) && !claims(rest) ? capitalize(rest) : "";
      if (said) kept.push(said);
      if (offer) { kept.push(DRAW_OFFER); offer = false; }
    }
    const out = kept.join(" ");
    return out ? marker + out : null;
  });
  if (!changed) return text;
  const out = lines.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || DRAW_OFFER;
}
