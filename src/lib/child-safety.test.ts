import { describe, it, expect } from "vitest";
import { isSafetyDisclosure, SAFETY_NOTICE, CHILD_SAFETY_RULES } from "./child-safety";
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

  it("fires on abuse disclosures", () => {
    for (const m of [
      "my dad hits me when he's angry", "my uncle touched me and told me not to tell",
      "someone is hurting me", "my mom's boyfriend abuses me", "I'm scared to go home",
      "I am not safe at home", "he beat me up after school", "I was molested",
    ]) expect(isSafetyDisclosure(m), m).toBe(true);
  });

  it("does not fire on schoolwork", () => {
    for (const m of [
      "How do I kill the process in Linux?", "Why did the character died at the end of the story?",
      "the character died in chapter 3", "how do I cut the fraction in half", "Can you cut this sentence shorter?",
      "my brother beats me at chess", "What is substance abuse?", "What was the abuse of power in Watergate?",
      "Explain how a hurricane hits the coast", "Hit me with another question!", "How do plants die in winter?",
      "What is 3/4 + 1/8?", "", "   ",
    ]) expect(isSafetyDisclosure(m), m).toBe(false);
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

// ChatTab is DOM-coupled and not rendered in vitest, so pin that its chat path calls these functions.
describe("ChatTab wiring", () => {
  it("screens each student message with isSafetyDisclosure and shows SAFETY_NOTICE", () => {
    expect(chatTabSource).toContain('from "../lib/child-safety"');
    expect(chatTabSource).toMatch(/msg\.role === "user" && isSafetyDisclosure\(msg\.content\) && \(/);
    expect(chatTabSource).toContain("{SAFETY_NOTICE}");
  });

  it("builds the tutor's system prompt with gradePromptLayer(grade), not the reading level alone", () => {
    expect(chatTabSource).toMatch(/personaIdentityLayer\(persona\),\s*gradePromptLayer\(grade\),\s*\)/);
    expect(chatTabSource).not.toContain("readingLevelLayer(");
  });
});
