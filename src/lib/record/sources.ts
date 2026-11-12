// The rows the learning record (#258) is built from, exactly as db.ts reads them for one learner
// (getRecordSource / getLearnerRecordSource). Every date stays the string SQLite stored: UTC
// "YYYY-MM-DD HH:MM:SS" from datetime('now'), parsed with early/engine.ts parseUtc. Plain data only,
// so a source and the record built from it both survive JSON.

import type { Subtopic } from "../../types";
import type { GradedBy } from "../quiz-grading";

export interface RecordLearner {
  id: string;
  name: string;
  grade: number | null;
  record_voice: "self" | "guided" | null;
  /** 'MM-DD', or null for the default (Aug 1). */
  record_year_start: string | null;
}

export interface RecordCourse {
  id: string;
  title: string;
  /** Integer 1-6. A fraction marks a legacy course (CLAUDE.md, curriculum architecture). */
  current_level: number;
  status: "active" | "completed" | "archived";
  subject: string | null;
  created_at: string;
}

export interface RecordSyllabus {
  course_id: string;
  level: number;
  title: string;
  learning_objectives: string[];
  subtopics: Subtopic[];
}

export interface RecordAttempt {
  id: string;
  course_id: string;
  quiz_type: "quiz" | "promotion";
  level: number;
  score: number | null;
  total_questions: number;
  correct_count: number;
  time_taken_seconds: number | null;
  started_at: string;
  completed_at: string | null;
  /** Level tests from migration 18: 1 passed, 0 not passed. NULL before. */
  passed: number | null;
}

export interface RecordQuestion {
  id: string;
  attempt_id: string;
  question_text: string;
  question_type: string;
  correct_answer: string;
  user_answer: string | null;
  /** 1, 0, or NULL when grading never ran. */
  is_correct: number | null;
  explanation: string;
  subtopic_id: string | null;
  self_explanation: string | null;
  /** NULL before migration 18, and on a free-text answer that was never graded. */
  graded_by: GradedBy | null;
}

/** One message the learner sent the tutor (role 'user' only; the text is never read). */
export interface RecordChat {
  course_id: string;
  thread_id: string | null;
  created_at: string;
}

export interface RecordLesson {
  course_id: string;
  level: number;
  /** lessons.topic_string: the skill title the app's model wrote, when the lesson was made. */
  topic: string;
  read_at: string;
}

export interface RecordFlashcard {
  course_id: string;
  /** 'manual' is the learner's own; anything else the app made. */
  source: string;
  created_at: string;
  last_reviewed_at: string | null;
}

export interface RecordFlashcardReview {
  course_id: string;
  reviewed_at: string;
}

/** A note the learner started (origin 'learner', migration 18) with something in it. */
export interface RecordNote {
  course_id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface RecordSubtopicEvent {
  course_id: string;
  level: number;
  subtopic_id: string;
  event: "practiced" | "mastered" | "review_needed" | "review_cleared";
  source: "tutor" | "keyword";
  correct: number | null;
  total: number | null;
  attempt_id: string | null;
  created_at: string;
}

export interface RecordLearnerDay {
  /** Local 'YYYY-MM-DD' (daily-goal.ts localDayKey). */
  day: string;
  minutes: number;
}

export interface RecordSource {
  learner: RecordLearner;
  /** app_config record_capture_since: when migration 18 ran. NULL only on a database without it. */
  captureSince: string | null;
  courses: RecordCourse[];
  syllabuses: RecordSyllabus[];
  attempts: RecordAttempt[];
  questions: RecordQuestion[];
  chats: RecordChat[];
  lessons: RecordLesson[];
  flashcards: RecordFlashcard[];
  flashcardReviews: RecordFlashcardReview[];
  notes: RecordNote[];
  subtopicEvents: RecordSubtopicEvent[];
  learnerDays: RecordLearnerDay[];
}
