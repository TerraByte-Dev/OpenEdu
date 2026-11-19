// A reply that only says the tutor is about to look something up ("I can look that up for you."), and
// nothing else. Before a tool call it answers nothing: TerraTutor click test 2026-11-19, "what is 7 times 8 in the
// times tables?" got "I can look that up for you.", two lookup chips, and then an empty model call, so the
// child never saw 56. TutorEngine treats a turn that has shown only this like one that has shown nothing
// yet: the empty call after the lookup is made once more, and a second empty one gets the plain line.
// Narrow on purpose: one short sentence that opens with the announcement, so "Let me check: 7 x 8 is 56."
// or anything with a number or a second sentence is a reply.

const LEAD = String.raw`(?:(?:ok(?:ay)?|sure|alright|great|good question|of course)[!.,]*\s+)?`;
const WHO = String.raw`(?:i can|i will|i['’]ll|i am going to|i['’]m going to|let me|let['’]s)`;
const DOES = String.raw`(?:look\s+(?:that|this|it)\s+up|look\s+up\b[^.!?\n\d]{0,40}|search\b[^.!?\n\d]{0,40}|check\s+(?:that|this|on that|for you)|find\s+(?:that|this|it|out)\b[^.!?\n\d]{0,30}|(?:calculate|compute|work out)\s+(?:that|this|it)|work\s+(?:that|this|it)\s+out)`;
const ANNOUNCEMENT = new RegExp(String.raw`^${LEAD}${WHO}\s+(?:quickly\s+|just\s+)?${DOES}(?:\s+for\s+you)?\s*[.!…]*$`, "i");

/** True when `text`, all a turn has shown, is only an announcement that the tutor will look something up. */
export function onlyAnnouncesLookup(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 120 && ANNOUNCEMENT.test(t);
}
