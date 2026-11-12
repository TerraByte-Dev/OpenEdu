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

/** The counted nouns the record uses, so a filled-in 1 reads "1 day", never "1 days". */
const ONE_OF = /\b1 (early sign|active minute|day|skill|sitting|answer|message|conversation|flashcard)s\b/g;

/** Singular after a count of exactly 1: "Rechecked 1 skills" → "Rechecked 1 skill". */
export function singular(text: string): string {
  return text.replace(ONE_OF, "1 $1");
}

/**
 * Fill {slots}, with counts of 1 made singular. Number slots go in first and only the template's own
 * words are made singular; text slots (titles the learner or the app's model wrote) go in after, so
 * "Unit 1 skills" stays exactly as written.
 */
export function fill(template: string, slots: Record<string, string | number>): string {
  const put = (text: string, numbers: boolean) =>
    text.replace(/\{(\w+)\}/g, (m, k: string) => (k in slots && (typeof slots[k] === "number") === numbers ? String(slots[k]) : m));
  return put(singular(put(template, true)), false);
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
    rechecked: "Skills mastered earlier come back in later quizzes. Held means 90% or more every time it came back in this period. Exact repeats of an earlier question are not counted.",
    lessons: "Only the first opening is stored. Reading time and re-reads are not stored.",
    hard_ones: "Questions marked wrong in this period, word for word. The questions and answer keys were written by the app's model and can be wrong.",
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
  /** Section D and the cover sheet's H5 lines. On paper each "____" is a ruled line to write on. */
  writeIn: {
    otherLearning: "Other learning this month (not in OpenEdu)",
    otherLearningPeriod: "Other learning in this period (not in OpenEdu)",
    reflectionHead: "Learner reflection",
    reflection: ["What was hard?", "What am I proud of?", "What can I do now that I couldn't before?"],
    grownUpNotes: "Grown-up notes",
    attestation: "I reviewed this record. The written-in sections are accurate. Everything else was produced by OpenEdu from activity on this computer.",
    signature: "Signature",
    date: "Date",
    coverFields: ["Date of birth", "State and homeschool option", "School year"],
  },
  authorship: "Course, level and skill titles, level objectives, quiz questions and answer keys were written by the app's model.",
  saveHelper: "A dated record you can keep as one piece of evidence in a homeschool portfolio. Print it, or save it as a PDF.",
  /** The printed record (spec §4a): Save, the name check, page 1, the cover sheet and the detail pages. */
  print: {
    save: "Save {month}'s record",
    saveYear: "Save this school year's record",
    saveSince: "Save your record so far",
    hint: "To keep it as a file, choose 'Save as PDF' as the printer.",
    back: "Back to the record",
    previewTitle: "{name}'s record: {period}",
    kicker: "Learning record",
    coverKicker: "School-year record",
    detailKicker: "Detail pages",
    more: "+{n} more in the detail pages",
    standColumns: { course: "Course", level: "Level", mastered: "Mastered (quiz-checked)", early: "Early signs", learning: "Learning" },
    finished: "Finished",
    noCourses: "No course yet.",
    rulesPointer: "How each number is counted is at the end of the detail pages.",
    ownWordsShown: "The newest {shown} of {n} are printed here.",
    detailIntro: "Every list on these pages is complete, except where it says otherwise.",
    columns: { skill: "Skill", course: "Course", level: "Level", date: "Date", evidence: "Evidence", status: "Status", reason: "Reason" },
    cover: {
      fieldsHead: "Filled in by hand",
      totalsHead: "Totals",
      tableHead: "By subject and course",
      columns: { name: "Subject and course", mastered: "Skills mastered (quiz-checked)", levels: "Levels passed", quizzes: "Quizzes and level tests", time: "Time (approximate)" },
      subjectsOnly: "Each subject's courses are listed in the detail pages.",
      subjectTotal: "{subject}",
      allCourses: "All courses",
      timeNote: "Time for each course is estimated with the approximate method over the whole period, so it does not add up to the time total above.",
      timeNoteCounted: "Time for each course is estimated with the approximate method over the whole period, so it does not add up to the counted total above.",
      days: "Days with learning",
      time: "Time",
      mastered: "Skills mastered (quiz-checked)",
      early: "Early signs (fewer than 3 questions)",
      levels: "Levels passed",
      quizzes: "Quizzes and level tests",
    },
    nameCheck: {
      head: "Whose record is this?",
      body: "The saved record shows the learner's name and grade. You can skip this: a missing grade prints as “Grade not set”.",
      bodyNameOnly: "The saved record shows the learner's name. You can skip this.",
      name: "Name",
      grade: "Grade",
      saveAndContinue: "Save and continue",
      skip: "Skip",
      failed: "Could not save that. Try again, or skip.",
    },
    printAll: "Print every learner's record",
    printAllRange: "Range for every learner's record",
    printAllMonth: "This month",
    printAllYear: "This school year",
    printAllTitle: "Every learner's record: {period}",
    printAllLoading: "Reading every learner's record…",
    printAllFailed: "Could not read every learner's record. Try again.",
  },
  /** The on-screen view (src/views/record/Record.tsx) and its entry points. */
  view: {
    myRecord: "My record",
    namedRecord: "{name}'s record",
    whoReads: "Who reads this?",
    voiceQuestion: "Who reads this record?",
    voiceMe: "Me",
    voiceGrownUp: "A parent or teacher",
    voiceHelp: "The record is written for whoever reads it. You can change this any time with “Who reads this?” at the top.",
    voiceSaveFailed: "Could not save that choice. Try again.",
    voiceKeep: "Keep it as it is",
    backHome: "Back to Home",
    backTeacher: "Back to all learners",
    rangeLabel: "Show",
    schoolYear: "This school year",
    sinceStarted: "Since you started",
    loading: "Reading the record…",
    loadFailed: "The record could not be read. Try again.",
    tryAgain: "Try again",
    ruleButton: "How this is counted: {what}",
    everything: "Everything you've mastered",
    everythingTotal: "Since you started: {n} skills mastered (quiz-checked)",
    everythingEmpty: "Skills show here once a quiz checks them: 90% or more right on at least 3 questions.",
    masteredHead: "What {who} mastered {when}",
    you: "you",
    inMonth: "in {month}",
    masteredNone: "No skill was mastered with quiz proof in this period.",
    talkAboutIt: "Talk about it",
    recheckedHead: "Rechecked",
    recheckedNone: "No skill mastered earlier came back in a quiz in this period.",
    slipped: "Slipped: {skills}",
    standHead: "Where things stand",
    standAsOf: "As of {date}",
    subject: "Subject for this course",
    subjectSaveFailed: "Could not save the subject. Try again.",
    skillsLine: "{mastered} of {total} skills mastered (quiz-checked)",
    earlySigns: "{n} early signs",
    learningCount: "{n} learning",
    levelLine: "Level {level}: {title}",
    levelOnly: "Level {level}",
    laterOne: "Later level: {n}",
    approxPill: "approximate",
    earlierLevels: "Earlier levels",
    levelsHead: "Levels passed",
    levelsNone: "No level was passed in this period.",
    levelRow: "Level {level} · {course}",
    learningHead: "Still learning",
    hardHead: "Hard ones",
    hardNone: "No skill had 3 or more questions under 70% right in this period.",
    quizzesHead: "Quizzes and level tests",
    quizzesNone: "No quiz or level test was finished in this period.",
    columns: { date: "Date", course: "Course", level: "Level", type: "Type", result: "Result", time: "Time" },
    unansweredNote: "{n} unanswered",
    resultCell: "{correct} of {total}",
    resultScore: "{correct} of {total} ({score}%)",
    underMinute: "under 1 min",
    hardLine: "{correct} of {total} right in this period",
    ownWordsSelf: "In your own words",
    ownWordsNamed: "In {name}'s own words",
    ownWordsNone: "Nothing written in this period.",
    explanationOn: "On {skill}",
    activityHead: "Activity",
    coursesStartedNone: "No new course started.",
    timeHead: "Time by subject and course",
    timeNone: "No time on record in this period.",
    withoutHead: "Mastered in the app without quiz proof",
    withoutNone: "Nothing in this period.",
    howHead: "How this record is counted",
    howDays: "Days with learning",
    howTimeApprox: "Time (approximate)",
    howTimeCounted: "Time (counted)",
    howLessons: "Lessons first opened",
    what: { days: "days with learning", time: "time", mastered: "skills mastered", lessons: "lessons first opened" },
    tileHeads: { days: "Days", time: "Time", mastered: "Skills" },
    about: "About {time}",
    labelsHead: "What the labels mean",
    disclaimerHead: "About this record",
    minutes: "{n} min",
    hoursMinutes: "{h} h {m} min",
    teaser: "Your {month} so far: {days} · {mastered}.",
    teaserDays: "at least {n} days with learning",
    teaserMastered: "{n} skills mastered",
    teaserOpen: "Open your record",
    menuItem: "Learning record",
    teacherPick: "Learning record for",
    teacherOpen: "Open record",
    earlyNote: "Activities on the early-learner screens are in the Grown-ups view.",
    tutorUndated: "Marked by the tutor in conversation, date not recorded (not quiz-checked)",
    keywordUndated: "Matched by the app from an untagged question, date not recorded (not quiz-checked)",
  },
} as const;

/** The fixed subject list for a course (spec §2). A label only: it makes no claim about state subjects. */
export const RECORD_SUBJECTS: ReadonlyArray<string> = [
  "Math", "English/Language Arts", "Science", "Social Studies/History", "Foreign language", "Arts", "Health/PE", "Other",
];

export function isRecordSubject(value: unknown): value is string {
  return typeof value === "string" && RECORD_SUBJECTS.includes(value);
}
