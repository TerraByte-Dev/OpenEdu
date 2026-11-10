// "What should I do next?" — the one ranking the app has, shared by the Next step card inside a
// course and the Continue button on the learner's Home. Pure: it returns intents, and the view that
// calls it decides how to carry each one out (switch a tab, open the level test, rebuild a plan).
// Extracted from NextStepCard so Home can reuse the rules without a DOM.

import type { Course, Syllabus, QuizAttempt } from "../types";
import type { SwitchTabOpts, Tab } from "../views/CourseView";
import { describeGenerationState } from "./plain-language";

export type NextStepAction =
  | { kind: "tab"; tab: Tab; opts?: SwitchTabOpts }
  | { kind: "promotion" }
  | { kind: "regenerate" };

export interface NextStep {
  key: string;
  title: string;
  blurb: string;
  action?: NextStepAction;
  actionLabel?: string;
}

export interface NextStepInput {
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  /** All attempts for the course, newest first (getQuizAttempts orders by started_at DESC). */
  attempts: QuizAttempt[];
  /** Whether the caller can rebuild a missing level plan. */
  canRegenerate: boolean;
  /** Whether the caller can open the level test (viewing the course's current level). */
  canPromote: boolean;
}

export const PROMOTION_READY_PCT = 80;

export function rankNextSteps(input: NextStepInput): NextStep[] {
  const { course, level, currentSyllabus, attempts, canRegenerate, canPromote } = input;
  const out: NextStep[] = [];

  // Rule 1 — No syllabus for this level
  if (!currentSyllabus) {
    if (canRegenerate) {
      out.push({
        key: "generate",
        title: "Build this level's plan",
        blurb: "The plan for this level is missing. Build it to unlock lessons, quizzes and the tutor.",
        action: { kind: "regenerate" },
        actionLabel: "Build",
      });
    } else {
      out.push({
        key: "no-syllabus",
        title: "This level isn't written yet",
        blurb: "Once the course finishes building, this level's plan will appear here.",
      });
    }
    return out;
  }

  // Rule 2 — Generation incomplete (course-level pause/checkpoint)
  if (course.generation_state && course.generation_state !== "completed") {
    out.push({
      key: "resume",
      title: "Finish building this course",
      blurb: `${describeGenerationState(course.generation_state)} Click it in the list on the left to finish building it.`,
    });
  }

  const subtopics = currentSyllabus.subtopics;
  const total = subtopics.length;
  const masteredCount = subtopics.filter((s) => s.mastered).length;

  // Level-scoped attempt stats
  const levelAttempts = attempts.filter(
    (a) => a.level === level && a.quiz_type === "quiz" && a.completed_at !== null && a.score !== null
  );
  const lastAttempt = levelAttempts[0];
  const lastQuizPct = lastAttempt?.score ?? null;

  // Rule 3 — Ready for the level test
  if (
    canPromote &&
    total > 0 &&
    masteredCount >= total - 1 &&
    lastQuizPct !== null &&
    lastQuizPct >= PROMOTION_READY_PCT
  ) {
    out.push({
      key: "promotion",
      title: "You look ready to move up a level",
      blurb: `You've learned ${masteredCount} of ${total} topics and scored ${Math.round(lastQuizPct)}% on your last quiz.`,
      action: { kind: "promotion" },
      actionLabel: "Take the test",
    });
  }

  // Rule 4 — No quiz attempts at this level
  if (levelAttempts.length === 0) {
    out.push({
      key: "first-quiz",
      title: "Try a practice quiz",
      blurb: "A quick quiz shows what you know and what to work on next.",
      action: { kind: "tab", tab: "quiz" },
      actionLabel: "Start quiz",
    });
  }

  // Rule 4b — An untouched subtopic: read a clean lesson before practicing
  const untouched = subtopics.find((s) => !s.practiced && !s.mastered);
  if (untouched && out.length < 3) {
    out.push({
      key: `lesson-${untouched.id}`,
      title: `Read the lesson on "${untouched.title}"`,
      blurb: "A short, clear walkthrough before you practice.",
      action: { kind: "tab", tab: "lessons", opts: { lessonSubtopicId: untouched.id } },
      actionLabel: "Read",
    });
  }

  // Rule 5 — A previously-mastered subtopic flagged for review
  const reviewSub = subtopics.find((s) => s.review_needed);
  if (reviewSub) {
    out.push({
      key: `review-${reviewSub.id}`,
      title: `Go over "${reviewSub.title}" again`,
      blurb: "You missed a question about this recently.",
      action: { kind: "tab", tab: "chat", opts: { seedTopic: reviewSub.title } },
      actionLabel: "Ask the tutor",
    });
  }

  // Rule 6 — Default: chat about the weakest subtopic
  if (out.length < 3) {
    const weakest =
      subtopics.find((s) => !s.mastered && !s.practiced) ??
      subtopics.find((s) => !s.mastered) ??
      subtopics[0];
    if (weakest) {
      out.push({
        key: `chat-${weakest.id}`,
        title: `Talk to your tutor about "${weakest.title}"`,
        blurb: "Work through it together before your next quiz.",
        action: { kind: "tab", tab: "chat", opts: { seedTopic: weakest.title } },
        actionLabel: "Ask the tutor",
      });
    }
  }

  return out.slice(0, 3);
}

// The Home screen's Continue button: the first step that has something to do. Rule 2 ("finish
// building") has no action of its own because the resume path is a separate affordance; callers
// handle an unfinished course before asking for this.
export function continueStep(steps: NextStep[]): NextStep | null {
  return steps.find((s) => s.action) ?? steps[0] ?? null;
}
