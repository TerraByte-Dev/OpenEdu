export interface Course {
  id: string;
  title: string;
  topic: string;
  current_level: number;
  status: "active" | "completed" | "archived";
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
}

export interface TutorInstruction {
  id: string;
  course_id: string;
  instruction_type: "identity" | "pedagogy" | "rules" | "curriculum_context" | "progress_context" | "assessment_mode";
  content: string;
  version: number;
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
  question_type: "multiple_choice" | "true_false" | "short_answer";
  options: string[] | null;
  correct_answer: string;
  user_answer: string | null;
  is_correct: boolean | null;
  difficulty_level: number;
  explanation: string;
  subtopic_id?: string | null;
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

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  ollamaUrl?: string;
}

export type View = "dashboard" | "course" | "settings";

export interface AppState {
  currentView: View;
  selectedCourseId: string | null;
  sidebarCollapsed: boolean;
}
