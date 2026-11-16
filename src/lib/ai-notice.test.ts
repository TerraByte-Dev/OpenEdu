import { describe, it, expect } from "vitest";
import {
  AI_DISCLOSURE, breakReminder, lessonsNote, lessonStatusLine, LESSONS_NOTE_TITLE, LESSONS_NOTE_UNCHECKED, LESSONS_NOTE_CHECKED,
  LESSON_STATUS_UNCHECKED, LESSON_STATUS_CHECKED, LESSON_STATUS_UNCHECKED_EARLY, LESSON_STATUS_CHECKED_EARLY,
} from "./ai-notice";
import { APP_NAME } from "./product";
import { speakableText } from "./speech";
import { GRADES, isEarlyReader } from "./grade";
import chat from "../components/ChatTab.tsx?raw";
import app from "../App.tsx?raw";
import architecture from "../../docs/ARCHITECTURE.md?raw";
import lessonReader from "../components/LessonReader.tsx?raw";
import lessonsTab from "../components/LessonsTab.tsx?raw";
import courseView from "../views/CourseView.tsx?raw";
import raiseHand from "../components/RaiseHand.tsx?raw";
import lessonsNoteTsx from "../views/settings/LessonsNote.tsx?raw";
import providerModels from "../views/settings/sections/ProviderModels.tsx?raw";

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

// ─── Whether a lesson was checked (from TerraTutor #144, Fable's decision 2026-11-16) ─────────────────

describe("About the lessons: the grown-up note", () => {
  it("has Fable's words, with OpenEdu's name and no course approval", () => {
    expect(LESSONS_NOTE_TITLE).toBe("About the lessons");
    expect(LESSONS_NOTE_UNCHECKED).toBe("OpenEdu's AI writes each lesson on this computer, and nothing checks it. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons with your child, and trust your own judgment over the app's.");
    expect(LESSONS_NOTE_CHECKED).toBe("A second AI reads each new lesson before your child sees it. It catches many mistakes, not all of them. It is still worth reading new lessons with your child.");
  });

  it("unchecked with no Checking model, or one on this computer however big; never a number", () => {
    for (const checker of [null, { provider: "ollama", model: "gemma4:e2b" }, { provider: "ollama", model: "qwen3.5:27b" }] as const) {
      expect(lessonsNote(checker)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED });
    }
    expect(LESSONS_NOTE_UNCHECKED).not.toMatch(/\d/);
  });

  it("checked when lesson checking resolves to a cloud model", () => {
    for (const checker of [{ provider: "anthropic", model: "claude-haiku-5-5" }, { provider: "openai", model: "gpt-5.5-mini" }, { provider: "ollama", model: "gpt-oss:120b-cloud" }] as const) {
      expect(lessonsNote(checker)).toEqual({ checked: true, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_CHECKED });
    }
  });
});

describe("the lesson's status line", () => {
  it("has Fable's four lines, by checked and by K-2, each ending with Just me's 'look it up'", () => {
    expect(lessonStatusLine({ checked: false, grade: null })).toBe("The AI wrote this lesson. Nothing has checked it. If something looks wrong, look it up.");
    expect(lessonStatusLine({ checked: false, grade: 3 })).toBe(LESSON_STATUS_UNCHECKED);
    expect(lessonStatusLine({ checked: false, grade: 0 })).toBe("The AI wrote this. No one checked it. If something looks wrong, look it up.");
    expect(lessonStatusLine({ checked: false, grade: 2 })).toBe(LESSON_STATUS_UNCHECKED_EARLY);
    expect(lessonStatusLine({ checked: true, grade: 12 })).toBe("The AI wrote this lesson, and a second AI checked it. It can still be wrong. If something looks wrong, look it up.");
    expect(lessonStatusLine({ checked: true, grade: null })).toBe(LESSON_STATUS_CHECKED);
    expect(lessonStatusLine({ checked: true, grade: 1 })).toBe("The AI wrote this. A second AI checked it. It can still be wrong. If something looks wrong, look it up.");
    expect(lessonStatusLine({ checked: true, grade: 1 })).toBe(LESSON_STATUS_CHECKED_EARLY);
  });

  it("'checked' always comes with 'it can still be wrong', and no line carries a number", () => {
    for (const grade of [null, ...GRADES]) {
      const checked = lessonStatusLine({ checked: true, grade });
      expect(checked).toContain("It can still be wrong.");
      for (const line of [checked, lessonStatusLine({ checked: false, grade })]) expect(line).not.toMatch(/\d/);
    }
  });
});

describe("the words it never uses", () => {
  const all = [
    LESSONS_NOTE_TITLE, LESSONS_NOTE_UNCHECKED, LESSONS_NOTE_CHECKED,
    LESSON_STATUS_UNCHECKED, LESSON_STATUS_CHECKED, LESSON_STATUS_UNCHECKED_EARLY, LESSON_STATUS_CHECKED_EARLY,
  ];
  it("no quality claim, model name, tier, RAM, price or upgrade", () => {
    for (const s of all) {
      expect(s).not.toMatch(/verified|certified|\bsafe\b|accurate|fact-checked|approved|hallucinat|error rate|may occasionally/i);
      expect(s).not.toMatch(/gemma|qwen|claude|sonnet|haiku|gpt|openai|anthropic|\btiny\b|\bsmall\b|\bGB\b|\bRAM\b|\$|price|\bPlus\b|upgrade|TerraTutor/i);
    }
  });
});

describe("where it shows", () => {
  it("the status line sits at the foot of the lesson reader, caption style, with no icon and no colour", () => {
    expect(lessonsTab).toContain("lessonStatusLine({ checked: check.checked, grade })");
    expect(lessonsTab).toContain("lessonWasChecked(");
    expect(courseView).toMatch(/<LessonsTab[\s\S]*?grade=\{grade\}[\s\S]*?\/>/);
    const at = lessonReader.indexOf("{status && ");
    expect(at).toBeGreaterThan(lessonReader.indexOf("<article"));
    const line = lessonReader.slice(at, lessonReader.indexOf("\n", at));
    expect(line).toContain("text-[var(--ink-faint)]");
    expect(line).toContain("text-[14px]");
    expect(line).not.toMatch(/Icon|warning|danger|success|phosphor|role=/);
  });

  it("is not read aloud by itself, and Raise hand gets no line of its own", () => {
    expect(lessonReader).not.toMatch(/speak|ReadAloud|read-aloud/i);
    expect(raiseHand).not.toMatch(/lessonStatusLine|LESSON_STATUS|LessonsNote|lessonsNote/);
  });

  it("the grown-up note sits above the Checking model picker, from the settings the Lessons tab writes with", () => {
    const row = providerModels.indexOf('label="Checking model"');
    const noteAt = providerModels.indexOf("<LessonsNote ");
    expect(noteAt).toBeGreaterThan(row);
    expect(noteAt).toBeLessThan(providerModels.indexOf("<ReviewModelPicker", row));
    expect(lessonsNoteTsx).toContain("getLessonConfigs()");
    expect(lessonsTab).toContain("getLessonConfigs()");
    // The note only says what is set: it saves no Checking model and confirms no notice.
    expect(lessonsNoteTsx).not.toMatch(/setReviewModel|markCloudNoticeSeen/);
  });
});
