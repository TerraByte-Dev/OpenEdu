import { describe, it, expect } from "vitest";
import { AI_DISCLOSURE, breakReminder } from "./ai-notice";
import { APP_NAME } from "./product";
import { speakableText } from "./speech";
import { GRADES, isEarlyReader } from "./grade";
import chat from "../components/ChatTab.tsx?raw";
import app from "../App.tsx?raw";
import architecture from "../../docs/ARCHITECTURE.md?raw";

const sentences = (s: string) => s.split(/(?<=[.!?])\s+/);
const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("the AI disclosure", () => {
  it("says the tutor is an AI and not a person, in the product's name", () => {
    expect(AI_DISCLOSURE).toBe(`${APP_NAME}'s tutor is an AI, not a person.`);
  });

  it("is always on screen in the chat: in its header, not only when the chat is empty", () => {
    expect(chat.match(/\{AI_DISCLOSURE\}/g)).toHaveLength(1);
    const at = chat.indexOf("{AI_DISCLOSURE}");
    expect(at).toBeGreaterThan(chat.indexOf("Persona header"));
    expect(at).toBeLessThan(chat.indexOf("{/* Messages */}"));
  });
});

describe("the break reminder's words", () => {
  it("say the tutor is an AI, not a person, and suggest a break, for every grade and none", () => {
    for (const grade of [null, ...GRADES]) {
      const text = breakReminder(3, grade);
      expect(text).toMatch(/is an AI, not a person\./);
      expect(text).toMatch(/break/);
    }
  });

  it("for K-2: short sentences, under 10 words each, and nothing the read-aloud would change", () => {
    for (const grade of GRADES.filter(isEarlyReader)) {
      const text = breakReminder(3, grade);
      for (const s of sentences(text)) expect(words(s).length).toBeLessThan(10);
      expect(speakableText(text)).toBe(text);
    }
  });

  it("for older learners and no grade: how long they have been learning", () => {
    expect(breakReminder(6, 7)).toBe(`You've been learning for 6 hours. Remember, ${APP_NAME}'s tutor is an AI, not a person. It's a good time to take a break.`);
    expect(speakableText(breakReminder(3, null))).toBe(breakReminder(3, null));
  });

  it("show in a banner the learner can close, which is not a dialog", () => {
    expect(app).toContain("breakReminder(");
    expect(app).toContain("tickBreakClock(");
    expect(app).not.toMatch(/breakNotice[\s\S]{0,400}role="(?:alert)?dialog"/);
  });
});

describe("the docs", () => {
  it("never claim legal compliance, and leave whether the law applies to counsel", () => {
    expect(architecture).toContain("SB 243");
    expect(architecture).toMatch(/counsel decides whether/i);
    expect(architecture).not.toMatch(/\b(?:compliant with|complies with|in compliance with|SB 243[- ]compliant)\b/i);
    for (const s of [AI_DISCLOSURE, breakReminder(3, 0), breakReminder(3, null)]) expect(s).not.toMatch(/complian|SB 243|law/i);
  });
});
