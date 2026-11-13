import { describe, it, expect } from "vitest";
import { isSafetyDisclosure, SAFETY_NOTICE, CHILD_SAFETY_RULES } from "./child-safety";
import { speakableText } from "./speech";
import chatTabSource from "../components/ChatTab.tsx?raw";

describe("isSafetyDisclosure", () => {
  it("fires on suicide and self-harm disclosures", () => {
    for (const m of [
      "I want to kill myself", "i wanna die", "Sometimes I wish I was dead", "I'm suicidal",
      "I've been thinking about suicide", "I don't want to live anymore", "I dont want to be alive",
      "I don’t want to live", "I cut myself last night", "I keep hurting myself", "is self-harm bad",
      "I want to end my life", "everyone would be better off without me",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The review of #282 found every one of these returned false.
  it("fires on the suicide and self-harm wordings the first list missed", () => {
    for (const m of [
      "I do not want to live", "I don't wanna live", "I wanna be dead", "I wish I could die",
      "I wish I had never been born", "nobody would care if I died", "I want to end it all",
      "no reason to live", "I want to hurt my self", "I cut my wrists", "kms", "unalive myself",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("fires on abuse disclosures", () => {
    for (const m of [
      "my dad hits me when he's angry", "my uncle touched me and told me not to tell",
      "someone is hurting me", "my mom's boyfriend abuses me", "I'm scared to go home",
      "I am not safe at home", "he beat me up after school", "I was molested",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The review of #282 found every one of these returned false. Past-tense "hit me" is the likeliest.
  it("fires on the abuse wordings the first list missed", () => {
    for (const m of [
      "my dad hit me", "he hit me", "my dad beat me", "my dad beats me", "my mom hits us",
      "my mom slaps me", "he punches me", "my mom hurt me", "I am being abused",
      "he touches my private parts", "my stepdad hurts my sister",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  // The round-2 review of #282 found the " at "/" in " games exclusion dropped these, and the old
  // fixed "to kms"/"gonna kms" phrases missed the chat forms of "kms".
  it("fires on hits followed by at/in, more subjects and fillers, and chat kms", () => {
    for (const m of [
      "my dad hit me in the face", "he punched me in the stomach", "my dad hits me at night",
      "he touches me in bed", "he hit me at home", "my dad hit me in front of my friends",
      "my dad has been hitting me", "my dad's hitting me", "my step-dad hits me", "my dad smacks me",
      "my dad hits my little sister", "i wanna kms", "kms lol",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("fires on the low-priority recall additions: selfharm, backtick and acute apostrophes", () => {
    for (const m of ["is selfharm bad", "i don`t want to live", "i don´t want to live"])
      expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("does not fire on schoolwork", () => {
    for (const m of [
      "How do I kill the process in Linux?", "Why did the character died at the end of the story?",
      "the character died in chapter 3", "how do I cut the fraction in half", "Can you cut this sentence shorter?",
      "my brother beats me at chess", "What is substance abuse?", "What was the abuse of power in Watergate?",
      "Explain how a hurricane hits the coast", "Hit me with another question!", "How do plants die in winter?",
      "What is 3/4 + 1/8?", "", "   ",
      // From the review of #282: the old unanchored "touched me", "hits me", "hurts me" entries fired on these.
      "the story really touched me", "that poem touched me deeply", "what happens when a wave hits me",
      "if a baseball hits me how much force is it", "it hurts me to read this much", "my hand hurts me when I write",
      "they beat us in the finals", "The race is 5 kms long",
      // From the round-2 review of #282: unit conversion and the other games and sports wordings.
      "how do I convert miles to kms", "they beat us by 3 points", "they beat us 3-0",
      "she beat me to the answer", "my coach kicked me off the team",
    ]) expect(isSafetyDisclosure(m), m).toBe(false);
  });

  // Known, accepted false positives: each shows the notice on an ordinary message. They stay because
  // the matcher that would skip them would also skip real disclosures, and a wrong notice costs one
  // kind line of text. Pinned here so a change to that trade is a deliberate one.
  it("fires on these known, accepted false positives", () => {
    for (const m of [
      "Why did Romeo commit suicide?", "he hit me with a great idea", "I cut myself on the paper",
      "I hurt myself at recess", "why do the characters want to die in Romeo and Juliet",
      "women were raped during the war", "what does molest mean",
      "he hit me in dodgeball", "my brother hit me", "my teacher hit us with a pop quiz",
      "what would happen if i died my hair blue", "how does the author end it all",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("matches whole words only", () => {
    expect(isSafetyDisclosure("cut myselfie")).toBe(false);
    expect(isSafetyDisclosure("rapeseed oil")).toBe(false);
    expect(isSafetyDisclosure("grapes")).toBe(false);
  });
});

describe("SAFETY_NOTICE", () => {
  it("names the US crisis lines and a trusted grown-up", () => {
    expect(SAFETY_NOTICE).toContain("988");
    expect(SAFETY_NOTICE).toContain("Suicide & Crisis Lifeline");
    expect(SAFETY_NOTICE).toContain("1-800-422-4453");
    expect(SAFETY_NOTICE).toContain("Childhelp National Child Abuse Hotline");
    expect(SAFETY_NOTICE.toLowerCase()).toContain("tell a grown-up you trust");
    expect(SAFETY_NOTICE).toContain("If you are in danger right now, call 911.");
  });

  it("reads aloud in full, numbers included", () => {
    const spoken = speakableText(SAFETY_NOTICE);
    for (const w of ["911", "988", "1-800-422-4453", "grown-up you trust"]) expect(spoken, w).toContain(w);
  });
});

describe("CHILD_SAFETY_RULES", () => {
  it("covers the required rules", () => {
    const t = CHILD_SAFETY_RULES.toLowerCase();
    for (const w of ["sexual", "hurt yourself", "weapons", "drugs", "dangerous", "violence", "schoolwork", "grown-up they trust"])
      expect(t, w).toContain(w);
  });

  it("stays short for small models", () => {
    expect(Math.ceil(CHILD_SAFETY_RULES.length / 4)).toBeLessThan(110);
  });
});

// ChatTab is DOM-coupled and the repo has no jsdom, so it is not rendered in vitest. These are source
// matches, not a production-path test: they pin that the chat calls the functions above, which are
// the parts tested through the code production runs.
describe("ChatTab wiring", () => {
  it("screens each student message with isSafetyDisclosure and shows SAFETY_NOTICE", () => {
    expect(chatTabSource).toContain('from "../lib/child-safety"');
    expect(chatTabSource).toMatch(/msg\.role === "user" && isSafetyDisclosure\(msg\.content\) && \(/);
    expect(chatTabSource).toContain("{SAFETY_NOTICE}");
  });

  it("shows the notice at K-2's chat text size, with a speaker button that reads it", () => {
    expect(chatTabSource).toMatch(/role="note" className="chat-msg [^"]*text-sm[^"]*"/);
    expect(chatTabSource).not.toMatch(/role="note" className="[^"]*text-xs/);
    expect(chatTabSource).toContain("readAloud.toggle(safetyId, SAFETY_NOTICE)");
  });

  it("builds the tutor's system prompt with gradePromptLayer(grade, userText), not the reading level alone", () => {
    expect(chatTabSource).toMatch(/personaIdentityLayer\(persona\),\s*gradePromptLayer\(grade, userText\),\s*\)/);
    expect(chatTabSource).not.toContain("readingLevelLayer(");
  });
});
