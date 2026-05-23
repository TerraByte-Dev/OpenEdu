export interface Course {
  id: string;
  title: string;
  topic: string;
  current_level: number;
  status: "active" | "completed" | "archived";
  // null = fully generated (legacy or finished). Values:
  // "researching" | "outlining" | "instructions" | "syllabus_L1".."syllabus_L5" | "mastery" | "completed" | "failed:<step>"
  generation_state: string | null;
  created_at: string;
  updated_at: string;
}

export interface Syllabus {
  id: string;
  course_id: string;
  level: number;
  title: string;
  description: string;
  learning_objectives: string[];
  subtopics: Subtopic[];
  assessment_criteria: string[];
  estimated_hours: number;
  generated_at: string;
}

export interface Subtopic {
  id: string;
  title: string;
  key_concepts: string[];
  practice_type: string;
  mastered: boolean;
  // At least one tagged quiz question has been seen. Sticky once true.
  practiced?: boolean;
  // Soft UI hint: a previously-mastered subtopic was missed on a spaced-review
  // question. Cleared on the next correct hit. Never demotes `mastered`.
  review_needed?: boolean;
}

export interface TutorInstruction {
  id: string;
  course_id: string;
  instruction_type:
    | "identity"
    | "pedagogy"
    | "rules"
    | "curriculum_context"
    | "progress_context"
    | "assessment_mode"
    | "research"
    | "course_outline"        // markdown render of the structured outline (human-readable)
    | "course_outline_json"   // canonical JSON.stringified CourseOutline
    | "concept_ledger"        // JSON.stringified ConceptLedger
    | "knowledge_map"
    | "misconceptions"
    | "study_log"
    | "learning_profile";
  content: string;
  version: number;
}

export interface OutlineLevel {
  level: number;
  title: string;
  focus_areas: string[];
  key_outcomes: string[];
  bridge: string;
}

export interface CourseOutline {
  levels: OutlineLevel[];
  mastery_exam: {
    domains: string[];
    synthesis_skills: string[];
    scenarios: string[];
  };
}

export interface LevelLedgerEntry {
  level: number;
  title: string;
  introduced: string[];
  vocabulary: string[];
  skills: string[];
  bridge_out: string;
}

export interface ConceptLedger {
  version: 1;
  by_level: LevelLedgerEntry[];
}

export interface Note {
  id: string;
  course_id: string;
  level: number;
  title: string;
  content: string;
  sort_order: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  course_id: string;
  level: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  course_id: string;
  quiz_type: "quiz" | "promotion";
  level: number;
  score: number | null;
  total_questions: number;
  correct_count: number;
  time_limit_seconds: number | null;
  time_taken_seconds: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface QuizQuestion {
  id: string;
  attempt_id: string;
  question_text: string;
  question_type: "multiple_choice" | "true_false" | "short_answer" | "fill_in_blank" | "written_response" | "drag_to_match" | "word_problem";
  options: string[] | null;
  correct_answer: string;
  user_answer: string | null;
  is_correct: boolean | null;
  difficulty_level: number;
  explanation: string;
  subtopic_id?: string | null;
  matching_pairs?: Array<{ left: string; right: string }> | null;
  blank_position?: string | null;
  self_explanation?: string | null;
}

export interface Lesson {
  id: string;
  course_id: string;
  level: number;
  subtopic_id: string | null;
  topic_string: string;
  content: string;
  generated_at: string;
  read_at: string | null;
}

export interface UserProgress {
  id: string;
  course_id: string;
  knowledge_gaps: string[]; // subtopic IDs where student is weak
  total_quiz_score_avg: number | null;
  streak_days: number;
  last_active_at: string | null;
}

export type LLMProvider = "ollama" | "openai" | "anthropic";

export type ModelTier = "tiny" | "small" | "medium" | "large";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  ollamaUrl?: string;
  // Auto-derived tier. Populated by detectModelTier; not user-set.
  modelTier?: ModelTier;
}

export type View = "dashboard" | "course" | "settings" | "quiz" | "promotion-test";

export interface QuizViewContext {
  courseId: string;
  course: Course;
  level: number;
  syllabus: Syllabus;
  allSyllabuses: Syllabus[];
}

export interface AppState {
  currentView: View;
  selectedCourseId: string | null;
  sidebarCollapsed: boolean;
}
