import { describe, it, expect } from "vitest";
import {
  AI_DISCLOSURE, breakReminder, lessonsNote, lessonStatusLine, LESSONS_NOTE_TITLE, LESSONS_NOTE_UNCHECKED, LESSONS_NOTE_CHECKED,
  LESSONS_NOTE_UNCHECKED_CLOUD, LESSONS_NOTE_SELF_REVIEW, LESSONS_NOTE_NUDGE_DIFFERENT, lessonCheckCounts, sameModel,
  LESSONS_NOTE_UNCHECKED_E2B, LESSONS_NOTE_NUDGE_LOCAL, type LessonsNoteInput,
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

// ─── Whether a lesson was checked (Fable's decisions 2026-11-16) ────────────────────────────────────────

const e2b = { provider: "ollama", model: "gemma4:e2b" } as const;
const e4b = { provider: "ollama", model: "gemma4:e4b" } as const;
const qwen27 = { provider: "ollama", model: "qwen3.5:27b" } as const;
const sonnet = { provider: "anthropic", model: "claude-sonnet-5-5" } as const;
const haiku = { provider: "anthropic", model: "claude-haiku-5-5" } as const;
const gpt = { provider: "openai", model: "gpt-5.5" } as const;
const ollamaCloud = { provider: "ollama", model: "gpt-oss:120b-cloud" } as const;

type Ref = LessonsNoteInput["courseModel"];
// No cloud set up here, unless a test says otherwise.
const note = (courseModel: Ref, lessonChecker: Ref | null, cloud: Partial<Pick<LessonsNoteInput, "cloudKeys" | "noticesSeen">> = {}) =>
  lessonsNote({ courseModel, lessonChecker, cloudKeys: cloud.cloudKeys ?? {}, noticesSeen: cloud.noticesSeen ?? [] });
const BODIES = [LESSONS_NOTE_UNCHECKED_E2B, LESSONS_NOTE_UNCHECKED, LESSONS_NOTE_CHECKED, LESSONS_NOTE_UNCHECKED_CLOUD, LESSONS_NOTE_SELF_REVIEW];
const NUDGES = [LESSONS_NOTE_NUDGE_DIFFERENT, LESSONS_NOTE_NUDGE_LOCAL];

describe("About the lessons: the grown-up note", () => {
  it("has Fable's words, with OpenEdu's name and no course approval", () => {
    expect(LESSONS_NOTE_TITLE).toBe("About the lessons");
    expect(LESSONS_NOTE_UNCHECKED_E2B).toBe("OpenEdu's AI writes each lesson on this computer, and nothing checks it. When this model was tested on school topics for grades 4 and 8, about 1 lesson in 7 taught a fact that was wrong. The test ran on a close copy of OpenEdu's lesson writer, not this exact one, so treat the number as a guide. The Raise hand help can be wrong too. Read new lessons closely, and trust your own judgment over the app's.");
    expect(LESSONS_NOTE_UNCHECKED).toBe("OpenEdu's AI writes each lesson on this computer, and nothing checks it. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons closely, and trust your own judgment over the app's.");
    expect(LESSONS_NOTE_CHECKED).toBe("A second AI reads each new lesson before the learner sees it. It catches many mistakes, not all of them. It is still worth reading new lessons closely.");
    expect(LESSONS_NOTE_UNCHECKED_CLOUD).toBe("OpenEdu's AI writes each lesson, and nothing checks it. We have not measured how often these lessons get a fact wrong, so expect that some do. The Raise hand help can be wrong too. Read new lessons closely, and trust your own judgment over the app's.");
    expect(LESSONS_NOTE_SELF_REVIEW).toBe("OpenEdu's AI writes each lesson and then reads its own work over. That is not a second check, and we do not count it as one. Some lessons will teach a fact that is wrong, and the Raise hand help can be wrong too. Read new lessons closely, and trust your own judgment over the app's.");
    expect(LESSONS_NOTE_NUDGE_DIFFERENT).toBe("A different cloud model can check new lessons. It is sent the course topic as the learner typed it and the lesson text, and nothing else.");
    expect(LESSONS_NOTE_NUDGE_LOCAL).toBe("You have a cloud model set up. It can check new lessons. It is sent the course topic as the learner typed it and the lesson text, and nothing else.");
  });

  it("every body that names who writes names OpenEdu", () => {
    for (const s of [LESSONS_NOTE_UNCHECKED_E2B, LESSONS_NOTE_UNCHECKED, LESSONS_NOTE_UNCHECKED_CLOUD, LESSONS_NOTE_SELF_REVIEW]) expect(s.startsWith(`${APP_NAME}'s AI writes`)).toBe(true);
  });

  it("never 'your child', and never claims less is sent than the course topic the learner typed", () => {
    for (const s of [...BODIES, ...NUDGES]) {
      expect(s).not.toMatch(/your child|\bchild\b|\bkid/i);
      expect(s).not.toMatch(/nothing about the learner|never anything (?:about )?the learner|anything the learner typed/i);
    }
    for (const s of NUDGES) expect(s).toContain("the course topic as the learner typed it and the lesson text, and nothing else.");
  });

  it("gemma4:e2b on this computer, no Checking model or one on this computer however big: the figure, no nudge", () => {
    for (const courseModel of [e2b, { provider: "ollama", model: " Gemma4:E2B " }] as const) {
      for (const checker of [null, e2b, qwen27] as const) {
        expect(note(courseModel, checker)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED_E2B, nudge: null });
      }
    }
  });

  it("any other local course model: unchecked, no number, no nudge", () => {
    for (const courseModel of [e4b, qwen27, { provider: "ollama", model: "gemma4:e2b-it-q8_0" }] as const) {
      for (const checker of [null, e2b, qwen27] as const) {
        expect(note(courseModel, checker)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED, nudge: null });
      }
    }
  });

  it("a local course model with a cloud provider set up (its key saved and its notice confirmed): the local nudge under either body", () => {
    // The Checking model's own confirm (privacy.ts checkingNoticeMark) counts too: the nudge is about checking.
    for (const [p, mark] of [["openai", "openai"], ["anthropic", "anthropic"], ["anthropic", "checking:anthropic"]] as const) {
      const ready = { cloudKeys: { [p]: true }, noticesSeen: [mark] };
      expect(note(e2b, null, ready)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED_E2B, nudge: LESSONS_NOTE_NUDGE_LOCAL });
      expect(note(e4b, qwen27, ready)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED, nudge: LESSONS_NOTE_NUDGE_LOCAL });
    }
  });

  it("no local nudge without a confirmed cloud key: a key with no notice, a notice with no key, or the two for different companies", () => {
    for (const cloud of [
      { cloudKeys: { openai: true }, noticesSeen: [] },
      { cloudKeys: { openai: false, anthropic: false }, noticesSeen: ["openai", "anthropic"] },
      { cloudKeys: { openai: true }, noticesSeen: ["anthropic"] },
      { cloudKeys: { openai: true }, noticesSeen: ["checking:anthropic"] },
      { cloudKeys: {}, noticesSeen: ["ollama-cloud"] },
    ]) {
      expect(note(e2b, null, cloud).nudge).toBeNull();
      expect(note(e4b, null, cloud).nudge).toBeNull();
    }
  });

  it("checked when lesson checking resolves to a cloud model other than the course model, with no figure and no nudge", () => {
    const ready = { cloudKeys: { openai: true, anthropic: true }, noticesSeen: ["openai", "anthropic"] };
    for (const checker of [haiku, { provider: "openai", model: "gpt-5.5-mini" }, ollamaCloud] as const) {
      expect(note(e2b, checker)).toEqual({ checked: true, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_CHECKED, nudge: null });
      expect(note(e2b, checker, ready)).toEqual({ checked: true, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_CHECKED, nudge: null });
    }
    // A cloud course model checked by a different one, from the same company too (Haiku writes, Sonnet checks).
    expect(note(haiku, sonnet)).toMatchObject({ checked: true, body: LESSONS_NOTE_CHECKED, nudge: null });
    expect(note(sonnet, gpt).checked).toBe(true);
  });

  it("self-review when lesson checking resolves to the cloud course model itself, with the nudge to a different model", () => {
    for (const checker of [sonnet, { provider: "anthropic", model: " CLAUDE-Sonnet-5-5 " }] as const) {
      expect(note(sonnet, checker)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_SELF_REVIEW, nudge: LESSONS_NOTE_NUDGE_DIFFERENT });
    }
    expect(note(ollamaCloud, ollamaCloud).body).toBe(LESSONS_NOTE_SELF_REVIEW);
  });

  it("a cloud course model with no Checking model, or one on this computer: unchecked, no number, the nudge to a different model", () => {
    for (const courseModel of [sonnet, gpt, ollamaCloud] as const) {
      for (const checker of [null, e2b, qwen27] as const) {
        expect(note(courseModel, checker)).toEqual({ checked: false, title: LESSONS_NOTE_TITLE, body: LESSONS_NOTE_UNCHECKED_CLOUD, nudge: LESSONS_NOTE_NUDGE_DIFFERENT });
      }
    }
    // A cloud provider set up changes nothing for a cloud writer: it keeps the nudge to a different model.
    expect(note(sonnet, null, { cloudKeys: { anthropic: true }, noticesSeen: ["anthropic"] }).nudge).toBe(LESSONS_NOTE_NUDGE_DIFFERENT);
  });

  it("the first state that holds wins", () => {
    expect(note(e2b, sonnet).body).toBe(LESSONS_NOTE_CHECKED);
    expect(note(sonnet, sonnet).body).toBe(LESSONS_NOTE_SELF_REVIEW);
    expect(note(sonnet, e4b).body).toBe(LESSONS_NOTE_UNCHECKED_CLOUD);
  });

  it("a number only in the gemma4:e2b body, and no 'on this computer' when the lessons are not written here", () => {
    for (const s of [...BODIES, ...NUDGES]) expect(/\d/.test(s)).toBe(s === LESSONS_NOTE_UNCHECKED_E2B);
    for (const s of [LESSONS_NOTE_UNCHECKED_CLOUD, LESSONS_NOTE_SELF_REVIEW, ...NUDGES]) expect(s).not.toMatch(/on this computer/);
  });

  it("the e2b figure says where it comes from", () => {
    expect(LESSONS_NOTE_UNCHECKED_E2B).toContain("The test ran on a close copy of OpenEdu's lesson writer, not this exact one, so treat the number as a guide.");
  });

  it("lessonCheckCounts: a cloud checker that is not the writer; sameModel ignores case and spaces, not the provider", () => {
    expect(lessonCheckCounts(sonnet, haiku)).toBe(true);
    expect(lessonCheckCounts(sonnet, e2b)).toBe(true);
    expect(lessonCheckCounts(sonnet, sonnet)).toBe(false);
    expect(lessonCheckCounts({ provider: "anthropic", model: "CLAUDE-SONNET-5-5 " }, sonnet)).toBe(false);
    expect(lessonCheckCounts(e4b, e2b)).toBe(false);
    expect(lessonCheckCounts(null, e2b)).toBe(false);
    expect(sameModel({ provider: "openai", model: "x" }, { provider: "anthropic", model: "x" })).toBe(false);
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
    LESSONS_NOTE_TITLE, ...BODIES, ...NUDGES,
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
    // The reader's one speaker button reads the lesson, never the status line.
    expect(lessonReader.match(/<ReadAloudButton\b[^>]*>/g)).toEqual(["<ReadAloudButton text={lesson.content} />"]);
    expect(lessonReader).not.toMatch(/useReadAloud|speak\(|toggle\(/);
    expect(raiseHand).not.toMatch(/lessonStatusLine|LESSON_STATUS|LessonsNote|lessonsNote/);
  });

  it("the grown-up note sits above the Checking model picker, from the settings the Lessons tab writes with", () => {
    const row = providerModels.indexOf('label="Checking model"');
    const noteAt = providerModels.indexOf("<LessonsNote ");
    expect(noteAt).toBeGreaterThan(row);
    expect(noteAt).toBeLessThan(providerModels.indexOf("<ReviewModelPicker", row));
    // The note reads the settings through store.ts getLessonsNoteInput, which takes the models from
    // getLessonConfigs, the call the Lessons tab writes with (through curriculum.ts writeLessonOnce); it
    // draws its nudge line.
    expect(lessonsNoteTsx).toContain("getLessonsNoteInput()");
    expect(lessonsNoteTsx).toContain("lessonsNote(input)");
    expect(lessonsTab).toMatch(/writeLessonOnce\([^)]*, getLessonConfigs\)/);
    expect(lessonsNoteTsx).toContain("{note.nudge && ");
    // The note only says what is set: it saves no Checking model and confirms no notice.
    expect(lessonsNoteTsx).not.toMatch(/setReviewModel|markCloudNoticeSeen/);
  });
});
