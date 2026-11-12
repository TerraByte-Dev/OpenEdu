// Every fixed sentence of the learning record (#258, spec §2, §3, §5). The screen, the printed page and
// the CSV all read these, so a rule reads the same everywhere it appears. Templates use {name}-style
// slots filled by fill(). No word in BANNED_WORDS may appear anywhere here except the two disclaimers;
// copy.test.ts scans it, and every record built from its fixtures.

export const RECORD_FORMAT = 1;

export const RECORD_DISCLAIMER =
  "This is a learning record made by OpenEdu from activity on this computer. It is not a standardized test, an evaluation, a portfolio review or a transcript, and it does not show that any state requirement has been met. Quizzes are informal: the app writes them, and they are not normed. Written answers are marked by the app's model and can be wrong. Time is approximate unless it says \"counted\". Learning done away from OpenEdu is not included unless it is written in. Homeschool rules differ by state and change often, so check with your state's department of education or a homeschool legal group for what you need to keep or submit.";

export const RECORD_DISCLAIMER_SHORT =
  "Made by OpenEdu from activity on this computer. Quizzes are written and marked by the app, and written answers can be marked wrongly. Time is approximate unless it says \"counted\".";

/** Words the record never uses outside the disclaimers. Matched case-insensitively at a word start,
 * so plurals and endings ("transcripts", "officially") are caught too. */
export const BANNED_WORDS: ReadonlyArray<string> = [
  "compliant", "meets", "requirement met", "requirements met", "approved", "accredited", "certified", "official",
  "transcript", "evaluation", "assessment", "percentile", "stanine", "grade level", "above grade", "below grade",
  "verified", "attendance",
];

const BANNED_RE = BANNED_WORDS.map((w) => new RegExp(`\\b${w.replace(/ /g, "\\s+")}`, "i"));

export function bannedWordsIn(text: string): string[] {
  return BANNED_WORDS.filter((_, i) => BANNED_RE[i].test(text));
}

/** A title the app's model wrote, marked as such when it happens to contain a banned word. */
export function appTitle(title: string): string {
  return bannedWordsIn(title).length > 0 ? `${title} (title written by the app)` : title;
}

export function fill(template: string, slots: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in slots ? String(slots[k]) : m));
}

/** The skill pills (spec §3). Keys match build.ts SkillStatus. */
export type PillKey = "mastered" | "early_sign" | "review_again" | "learning" | "tutor" | "keyword" | "no_proof" | "not_yet";
export type TileKey = "days" | "time_approx" | "time_counted" | "mastered";

/** The rule behind every number and label: the ⓘ text, and "How this record is counted". */
export const RECORD_RULES: {
  tiles: Record<TileKey, string>;
  pills: Record<PillKey, string>;
  sections: Record<"rechecked" | "lessons" | "hard_ones", string>;
} = {
  tiles: {
    days: "A day counts when OpenEdu recorded you doing something that day: a quiz answer, a lesson opened, a tutor message or a flashcard. Some repeat activity is not stored, so this can undercount.",
    time_approx: "Approximate, and it can be over or under. Time runs from the first to the last recorded activity in each sitting. A sitting ends after 5 minutes with nothing recorded. A quiz counts for at most 2 minutes a question. Reading time inside a lesson is not stored.",
    time_counted: "A minute counts when OpenEdu was on screen on a learning screen and someone clicked, typed or scrolled in the last 2 minutes. Time on record, settings and teacher screens is not counted.",
    mastered: "Mastered means 90% or more of that skill's questions were answered right in one quiz or level test, with at least 3 questions. The app's own rule needs only one quiz at 90%. Fewer than 3 questions shows as an early sign.",
  },
  pills: {
    mastered: "90% or more of this skill's questions were answered right in one quiz or level test, on at least 3 questions.",
    early_sign: "90% or more right in one quiz, but on fewer than 3 questions.",
    review_again: "Mastered earlier, then under 90% on a later quiz. It stays mastered and clears at 90% again.",
    learning: "Practised in a quiz, not yet at 90% in one.",
    tutor: "The tutor marked this in conversation. No quiz has checked it.",
    keyword: "Matched to this skill from a question that wasn't tagged.",
    no_proof: "The app shows this skill as mastered, but no quiz on record proves it.",
    not_yet: "No quiz questions on this skill yet.",
  },
  sections: {
    rechecked: "Skills mastered earlier come back in later quizzes. Held means 90% or more every time it came back this month. Exact repeats of an earlier question are not counted.",
    lessons: "Only the first opening is stored. Reading time and re-reads are not stored.",
    hard_ones: "Questions marked wrong this month, word for word. The questions and answer keys were written by the app's model and can be wrong.",
  },
};

export const RECORD_COPY = {
  title: "OpenEdu · Record",
  printed: "Printed {date} · Record format {format}",
  builtFromCurrent: "Built {date} from the activity still on record.",
  gradeNotSet: "Grade not set",
  noSubject: "No subject set",
  tiles: {
    days: "At least {n} days with learning",
    time_approx: "About {time} · in {sittings} sittings",
    time_counted: "{n} active minutes (counted)",
    mastered: "Skills mastered (quiz-checked)",
    earlySigns: "Plus {n} early signs (fewer than 3 questions)",
  } satisfies Record<TileKey | "earlySigns", string>,
  pills: {
    mastered: "Mastered (quiz-checked)",
    early_sign: "Early sign",
    review_again: "Review again",
    learning: "Learning",
    tutor: "Marked by tutor (not quiz-checked)",
    keyword: "Matched by the app (not quiz-checked)",
    no_proof: "Marked mastered, no quiz proof",
    not_yet: "Not yet",
  } satisfies Record<PillKey, string>,
  evidence: {
    result: "{correct} of {total} right · {kind}",
    quiz: "quiz",
    levelTest: "level test",
    key: "{n} checked against the app's answer key",
    exact: "{n} matched the answer key exactly",
    model: "{n} judged by the app's model",
    fallback: "{n} passed when the grader failed",
    unanswered: "{n} unanswered",
    unknown: "{n} written answers, may have been judged by the app's model",
  },
  withoutProof: {
    tutor: "Marked by the tutor in conversation on {date} (not quiz-checked)",
    keyword: "Matched by the app from an untagged question on {date} (not quiz-checked)",
    fallback: "Grader failed on {n} answers, so this does not count as proof.",
    timed_out: "Level test timed out, and its unanswered questions were not stored, so this does not count as proof.",
    mixed: "Some questions on this skill were matched by keyword, so this quiz does not count as proof.",
    no_proof: "Marked mastered, no quiz proof on record. The tutor can mark a skill in conversation, the app can match an untagged question by keyword, or a level test may have timed out.",
  },
  rechecked: "Rechecked {n} skills · held {held} · slipped {slipped}",
  levels: {
    passed: "Passed {date}",
    passedUndated: "Passed (date not recorded)",
    levelPassedUndated: "Level {level} passed (date not recorded)",
    current: "Current level",
    later: "Later levels: {from}–{to}",
    notRecorded: "Level at month end not recorded",
    legacy: "Older course format: levels are not tracked.",
    finished: "Finished",
    objectives: "This level works on:",
  },
  reconciliation: "The app shows {shown} mastered: {checked} quiz-checked here, {early} early signs, {without} without quiz proof (see above).",
  learning: "{skill}: {correct} of {total} right so far",
  hardOnes: { question: "The app's question:", answered: "Answered:", key: "The app's answer key:" },
  talkAboutIt: {
    explain: "Ask {name} to explain “{skill}” to you.",
    readTogether: "Read this together and ask what {name} would add.",
    nextUp: "Next up: “{skill}”, {correct} of {total} so far.",
  },
  quizzes: {
    header: "Informal quizzes made by the app. Not standardized or normed.",
    quiz: "Quiz",
    levelTest: "Level test",
    passed: "Passed",
    notPassed: "Not passed",
    timedOutUnstored: "(timed out; unanswered questions not stored)",
    startedNotFinished: "Started, not finished: {n}",
    repeatFootnote: "Up to 1 in 5 quiz questions repeat earlier misses on purpose.",
  },
  ownWords: { noteStarted: "note started {date}" },
  activity: {
    lessons: "Lessons first opened: {n}",
    tutor: "{messages} messages to the tutor in {conversations} conversations",
    flashcards: "Made {n} flashcards",
    flashcardsByApp: "{n} more the app made from missed questions or the tutor",
    reviewed: "Reviewed {n} flashcards",
    notes: "Notes started: {n}",
    courseStarted: "Started: {title} ({date})",
  },
  writeIn: {
    otherLearning: "Other learning this month (not in OpenEdu)",
    reflection: ["What was hard?", "What am I proud of?", "What can I do now that I couldn't before?"],
    grownUpNotes: "Grown-up notes",
    attestation: "I reviewed this record. The written-in sections are accurate. Everything else was produced by OpenEdu from activity on this computer. Signature ____ Date ____",
    coverSheet: "Date of birth ____ · State and homeschool option ____ · School year ____",
  },
  authorship: "Course, level and skill titles, level objectives, quiz questions and answer keys were written by the app's model.",
  saveHelper: "A dated record you can keep as one piece of evidence in a homeschool portfolio. Print it, or save it as a PDF.",
} as const;
