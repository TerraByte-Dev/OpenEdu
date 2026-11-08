// Refusal phrases: does an answer say it cannot or will not give the fact asked for?
//
// Written for the RAG prompt-fidelity A/B (EVAL_PROMPT, #194) and committed before any of its runs, so
// the list was not tuned on the rows it scores. Over-refusal there is a real-world near-miss row that
// was NOT real-world answered (rag-dev-v2.ts realWorldAnswered) AND matches one of these. Requiring
// both keeps the count honest in both directions: an answer that says "your notes don't cover this,
// but it is 42" is answered, not a refusal, and a wrong value with no refusal phrase is a wrong
// answer, not a refusal.
//
// The phrases are generic English refusal and deferral shapes. They carry no item text. Matching is
// on lower case with curly apostrophes folded to straight ones.

export const REFUSAL_PATTERNS: RegExp[] = [
  // "I don't have / I do not have (the …, information, any data …)"
  /\bi (?:do not|don't|dont)(?: currently| actually)? have\b/,
  // "I don't know", "I'm not sure", "I am not certain"
  /\bi (?:do not|don't|dont) know\b/,
  /\bi(?:'m| am) not (?:sure|certain|aware)\b/,
  // "I can't find / cannot answer / am unable to provide / could not locate"
  /\bi (?:can't|cannot|can not|couldn't|could not|am unable to|'m unable to|am not able to|'m not able to) (?:find|locate|see|provide|answer|give|tell|confirm|determine|say|share|access)\b/,
  /\bunable to (?:find|locate|provide|answer|give|confirm|determine)\b/,
  // "no information", "not enough information", "no data on"
  /\b(?:no|not enough|insufficient) (?:specific |relevant |reliable )?(?:information|data|details)\b/,
  // "(your notes / the context / the reference) (doesn't / do not) (mention / contain / cover …)"
  /\b(?:notes?|context|passages?|materials?|sources?|reference(?: data| passages?)?|records?|documents?|information) (?:provided |given |here |available )?(?:don't|do not|doesn't|does not|didn't|did not) (?:mention|include|contain|cover|say|state|specify|provide|list|give|have|discuss|address)\b/,
  // "(it) is not mentioned / not included / not covered in (your notes / the context)"
  /\b(?:not|isn't|aren't|wasn't|weren't) (?:mentioned|included|covered|listed|given|provided|specified|stated|available|found|present|contained) (?:in|within|among) (?:your|my|the|these|those|our)\b/,
  // "not in your notes / outside the material I have"
  /\bnot (?:in|within|part of) (?:your|my|the|our) (?:notes|context|material|materials|reference|sources|course|syllabus)\b/,
  /\boutside (?:of )?(?:your|my|the|our|this|the current) (?:notes|context|material|materials|reference|sources|scope|course|syllabus|level)\b/,
  // The generated-course rules' own deferral: "beyond scope … a great question for a later level"
  /\bbeyond (?:the |our |this |your )?(?:current )?(?:scope|level|syllabus)\b/,
  /\b(?:for|at|in) a later level\b/,
];

/** True when the answer contains a refusal or deferral phrase from REFUSAL_PATTERNS. */
export function hasRefusalPhrase(answer: string): boolean {
  const t = answer.toLowerCase().replace(/[‘’ʼ]/g, "'");
  return REFUSAL_PATTERNS.some((re) => re.test(t));
}
