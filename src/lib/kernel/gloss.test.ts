import { describe, it, expect } from "vitest";
import { needsGloss, cleanGloss, glossMessages, GLOSS_INSTRUCTION } from "./gloss";
import { mergeCandidates } from "./ground";

describe("needsGloss", () => {
  it("is false for English, including Greek letters in maths, accents and symbols", () => {
    for (const q of [
      "What is photosynthesis?",
      "If the hypotenuse is 5, what is sin θ?",
      "What does π stand for, and how is Δx different from dx?",
      "Is a café au lait stronger than a naïve espresso?",
      "Why is 2 + 2 = 4? 🙂",
      "ok thanks",
      "",
    ]) expect(needsGloss(q), q).toBe(false);
  });

  it("is false for Latin-script languages (not targeted by L2)", () => {
    for (const q of ["¿Cuál es la capital de Francia?", "Quelle heure est-il ?", "Habari ya asubuhi, mwalimu?"]) expect(needsGloss(q), q).toBe(false);
  });

  it("is true for a word of two or more letters in another script, code-mixed or not", () => {
    for (const q of [
      "प्रकाश संश्लेषण क्या है?",
      "Photosynthesis क्या है?",
      "ما هو التمثيل الضوئي؟",
      "ፎቶሲንተሲስ ምንድን ነው?",
      "Что такое фотосинтез?",
      "光合作用是什么？",
      "Τι είναι η φωτοσύνθεση;",
    ]) expect(needsGloss(q), q).toBe(true);
  });
});

describe("cleanGloss", () => {
  it("trims and flattens, and rejects empty, echoed or overlong output", () => {
    expect(cleanGloss("  What is\n photosynthesis? ".replace("\n", "\n"), "प्रकाश संश्लेषण क्या है?")).toBe("What is photosynthesis?");
    expect(cleanGloss("   ", "x")).toBeNull();
    expect(cleanGloss("प्रकाश  संश्लेषण क्या है?", "प्रकाश संश्लेषण क्या है?")).toBeNull();
    expect(cleanGloss("a".repeat(301), "x")).toBeNull();
  });
});

describe("glossMessages", () => {
  it("is the turn's messages unchanged, then the instruction", () => {
    const msgs = [{ role: "system" as const, content: "S" }, { role: "user" as const, content: "Q" }];
    expect(glossMessages(msgs)).toEqual([{ role: "system", content: "S" }, { role: "user", content: "Q" }, { role: "user", content: GLOSS_INSTRUCTION }]);
  });
});

describe("mergeCandidates", () => {
  const hit = (key: string, score: number, source: "note" | "library" = "note") => ({ key, source, title: key, text: key, score, ref: key });
  it("keeps one entry per passage at its higher score, original order first", () => {
    const merged = mergeCandidates([hit("a", 0.3), hit("b", 0.6)], [hit("a", 0.7), hit("c", 0.5)]);
    expect(merged.map((h) => [h.ref, h.score])).toEqual([["a", 0.7], ["b", 0.6], ["c", 0.5]]);
    expect(merged[0]).not.toHaveProperty("key");
  });
  it("is the original list unchanged when the gloss search finds nothing new", () => {
    const merged = mergeCandidates([hit("a", 0.5), hit("lib:x", 0.5, "library")], [hit("a", 0.4)]);
    expect(merged.map((h) => [h.ref, h.score])).toEqual([["a", 0.5], ["lib:x", 0.5]]);
  });
});
