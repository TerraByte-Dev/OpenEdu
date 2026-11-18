import { describe, it, expect } from "vitest";
import { isSafetyDisclosure, pregnancyShape, SAFETY_NOTICE, CHILD_SAFETY_RULES } from "./child-safety";
import { GRADES } from "./grade";
import { fs, path, cwd } from "./eval/headless/node-io";
import {
  STRONG_PREGNANCY, REVIEW_342_STRONG, NOT_STRONG_PREGNANCY, REVIEW7_CLASS_A, REVIEW8_CLASS_A, REVIEW8_STILL_STRONG,
  PREGNANCY_CORPUS, BABY_WITH_STRONG, BABY_WITH_QUIET,
} from "./child-safety-pregnancy.fixtures";
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
  it("screens each student message with isSafetyDisclosure and the learner's grade, and shows SAFETY_NOTICE", () => {
    expect(chatTabSource).toContain('from "../lib/child-safety"');
    expect(chatTabSource).toMatch(/msg\.role === "user" && isSafetyDisclosure\(msg\.content, grade\) && \(/);
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

  // Ported from TerraTutor #165. The kernel side runs through tutorEngine.run in answerCheckTurn.test.ts.
  it("gives the kernel the same grade, and sends a disclosure typed into a card as the child's own message", () => {
    expect(chatTabSource).toMatch(/retrieval: await getRetrievalMode\(\),[^}]*\sgrade,\s+onText:/);
    expect(chatTabSource).toContain("result.cardMessage ? { thread, text: result.cardMessage, courseId, level } : null;");
    expect(chatTabSource).toContain("if (handedBack) { setCardMessage(handedBack); return; }");
    expect(chatTabSource).toContain("if (cardMessage.thread === threadId) void sendMessage(cardMessage.text);");
    // Never dropped: when the child has opened another conversation, the words are still saved to their own thread.
    expect(chatTabSource).toContain("if (turnOwnerRef.current !== owner) { if (handedBack) keepCardMessage(handedBack); return; }");
    expect(chatTabSource).toContain("else keepCardMessage(cardMessage);");
    expect(chatTabSource).toContain('saveChatMessage(m.courseId, "user", m.text, m.level, m.thread)');
  });
});

// A K-12 learner who says they may be pregnant (ported from TerraTutor #158). With a K-12 grade set, a strong
// self-disclosure in the message is a safety disclosure: ChatTab shows SAFETY_NOTICE under it, and the tutor
// already has CHILD_SAFETY_RULES for every K-12 learner. Nothing blocks on it. With no grade (an adult, or a
// learner who never set one), isSafetyDisclosure answers exactly as before. These call isSafetyDisclosure the
// way ChatTab does, with the message and the grade (ChatTab wiring, above).
describe("a strong self-disclosure of a pregnancy", () => {
  it("is a safety disclosure for a learner with any K-12 grade", () => {
    for (const g of GRADES) {
      for (const m of [...STRONG_PREGNANCY, ...REVIEW_342_STRONG, ...REVIEW8_STILL_STRONG]) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
    }
  });

  it("is not one with no grade set, so an adult sees exactly what they saw before", () => {
    for (const m of [...STRONG_PREGNANCY, ...REVIEW_342_STRONG, ...REVIEW8_STILL_STRONG]) {
      expect(isSafetyDisclosure(m, null), m).toBe(false);
      expect(isSafetyDisclosure(m), m).toBe(false);
    }
  });

  it("leaves a harm disclosure a disclosure with or without a grade", () => {
    const m = "my stepdad touches me at night and im scared im pregnant";
    expect(isSafetyDisclosure(m, null)).toBe(true);
    expect(isSafetyDisclosure(m, 7)).toBe(true);
    for (const g of [null, 0, 12] as const) {
      expect(isSafetyDisclosure("what is 9 x 9?", g)).toBe(false);
      expect(isSafetyDisclosure("", g)).toBe(false);
    }
  });

  it("stays quiet on anyone else, a baby one day, grade, Bible, story, game, joke, language and pretend forms", () => {
    for (const g of [null, ...GRADES]) {
      for (const m of NOT_STRONG_PREGNANCY) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
    }
  });

  // The corpus shared with TerraTutor #161 (every review input and fixture, tagged by source), through the call
  // ChatTab and grade.ts make: the notice on every strong input at every K-12 grade, none on any not-strong
  // input, and none at all with no grade. The accepted extra notices (lead decision after TerraTutor #161's
  // second final review: the notice never blocks, so a missed disclosure costs more) get the notice at every
  // K-12 grade too, pinned so a change to them shows here, and none with no grade.
  it("decides every input of the shared corpus as the reviews ruled", () => {
    const { strong, notStrong, acceptedExtraNotice } = PREGNANCY_CORPUS;
    expect(strong.length).toBe(85);
    expect(notStrong.length).toBe(144);
    expect(acceptedExtraNotice.length).toBe(10);
    const texts = [...strong, ...notStrong, ...acceptedExtraNotice].map((e) => e.text);
    expect(new Set(texts).size).toBe(texts.length);
    const wrong: string[] = [];
    for (const g of [null, ...GRADES]) {
      for (const e of [...strong, ...acceptedExtraNotice])
        if (isSafetyDisclosure(e.text, g) !== (g !== null)) wrong.push(`${g} notice: ${e.text} (${e.source})`);
      for (const e of notStrong) if (isSafetyDisclosure(e.text, g)) wrong.push(`${g} not strong: ${e.text} (${e.source})`);
    }
    expect(wrong).toEqual([]);
  });

  // TerraTutor #161's second final review, must-fix 1: "pregnant with" a partner, "nobody", "no money" or
  // "nowhere" is a disclosure, so there is no "pregnant with <thing>" guard. A laughing emoji and "food baby"
  // still make it a joke.
  it("gives the notice on \"pregnant with\" anything but a laughed-off joke or a food baby", () => {
    for (const m of [
      "im pregnant with my boyfriend", "i'm pregnant with my ex", "im pregnant with my bf's", "im pregnant with nobody to help me",
      "i'm pregnant with nobody to talk to", "im pregnant with no money and no job", "im pregnant with nowhere to go",
      "im pregnant with tacos",
    ]) {
      expect(isSafetyDisclosure(m, 8), m).toBe(true);
      expect(isSafetyDisclosure(m, null), m).toBe(false);
    }
    for (const m of ["im pregnant with tacos 😂", "im pregnant with a food baby"]) expect(isSafetyDisclosure(m, 8), m).toBe(false);
  });

  // Having a baby "with" someone next to the learner's own age, in either order (TerraTutor's same fix): the
  // notice at every K-12 grade, none with no grade. Someone else's baby, a sibling, family news, an age under 10
  // and pretend play stay quiet.
  it("gives the notice on having a baby with someone next to the learner's own age", () => {
    for (const g of GRADES) {
      for (const m of BABY_WITH_STRONG) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(true);
    }
    for (const m of BABY_WITH_STRONG) expect(isSafetyDisclosure(m, null), m).toBe(false);
    for (const g of [null, ...GRADES]) {
      for (const m of BABY_WITH_QUIET) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(false);
    }
  });

  it("keeps the guarded jokes, play and language-lesson forms as with no grade, at every grade", () => {
    for (const m of [...REVIEW7_CLASS_A, ...REVIEW8_CLASS_A]) {
      for (const g of GRADES) expect(isSafetyDisclosure(m, g), `${g}: ${m}`).toBe(isSafetyDisclosure(m, null));
    }
  });

  it("stays strong where the narrowing must not reach: a length of time, a might-be, the test's own words, a verb", () => {
    for (const m of [
      "i missed my period for 2 months", "i missed my period for a while now", "i feel like i might be pregnant",
      "my pregnancy test says positive", "i think im pregnant can you show me what to do", "im pregnant and i cant play soccer",
      "im pregnant and my mom said to ask you",
    ]) {
      expect(isSafetyDisclosure(m, 8), m).toBe(true);
      expect(isSafetyDisclosure(m, null), m).toBe(false);
    }
  });

  // An adult who got a K-12 learner pregnant is also an abuse disclosure; with a grade set it gets the notice
  // here. (With no grade, ABUSE_RE decides it, as on master.)
  it("counts someone else who got the learner pregnant, at every grade", () => {
    for (const g of GRADES) expect(isSafetyDisclosure("my stepdad got me pregnant", g), `${g}`).toBe(true);
  });

  it("reads the pregnancy word by its shape", () => {
    for (const w of ["prenant", "pragnent", "pregrant", "pregnat", "pregnet", "pregnint", "pergnant", "preganant", "pregnent", "pregant", "pregnantly"])
      expect(pregnancyShape(w), w).toBe("pregnant");
    for (const w of ["preg", "prego", "preggo", "preggy", "preggie", "preggers", "pregers"]) expect(pregnancyShape(w), w).toBe("pregnant");
    for (const w of ["pregnancy", "pregnancies", "pregnacy", "pregancy", "pregnency", "pregnance"]) expect(pregnancyShape(w), w).toBe("pregnancy");
    for (const w of ["pennant", "remnant", "poignant", "regnant", "poignancy", "present", "prevent", "prenatal", "pregame", "pre", "pig"])
      expect(pregnancyShape(w), w).toBe(null);
  });

  // The whole bundled English word list (public/wordlist/): every real word pregnancyShape accepts is a
  // pregnancy word. A word list update that adds a new neighbour fails here until it is excluded.
  it("accepts no ordinary English word", { timeout: 60_000 }, async () => {
    const [f, p] = await Promise.all([fs(), path()]);
    const dir = p.join(cwd(), "public", "wordlist");
    const files = (await f.readdir(dir, { withFileTypes: true })).map((d) => d.name).filter((n) => /^[a-z]{2}\.json$/.test(n));
    const accepted: string[] = [];
    for (const n of files) {
      for (const w of (JSON.parse(await f.readFile(p.join(dir, n), "utf8")) as string).split(" ")) if (pregnancyShape(w)) accepted.push(w);
    }
    expect(accepted.sort()).toEqual([
      "impregnant", "preggers", "preggy", "pregnance", "pregnances", "pregnancies", "pregnancy", "pregnant", "pregnantly", "unpregnant",
    ]);
  });
});
