export interface Course {
  id: string;
  title: string;
  topic: string;
  current_level: number;
  status: "active" | "completed" | "archived";
  // null = fully generated (legacy or finished). Values:
  // "researching" | "outlining" | "instructions" | "syllabus_L1".."syllabus_L5" | "mastery" | "completed" | "failed:<step>"
  generation_state: string | null;
  // Phase 4b persona (sprite tutor). NULL on legacy courses / when the picker is skipped →
  // buildSystemPrompt falls back to the generated tutor_instructions.identity.
  sprite_id?: string | null;
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
  folder_id: string | null; // which notebook_folders row this note lives in; null = vault root
  created_at: string;
  updated_at: string;
}

export interface NotebookFolder {
  id: string;
  course_id: string;
  name: string;
  parent_id: string | null; // nested folders; null = root
  sort_order: number;
  created_at: string;
}

// ── Notebook RAG (Phase 3) ──────────────────────────────────────────────────
// Ingested student material (notes / dropped .md/.txt) chunked + embedded for retrieval.
// Vectors are stored brute-force as JSON-array TEXT in notebook_embeddings.vec — see
// docs/ARCHITECTURE.md and the Phase 3 plan (sqlite-vec deferred; schema is vec0-compatible).
export type NotebookSourceType = "text" | "md" | "note" | "pdf" | "url";

export interface NotebookDocument {
  id: string;
  course_id: string;
  note_id: string | null; // the note this index entry belongs to (unified vault); null = legacy standalone
  title: string;
  source_type: NotebookSourceType;
  source_uri: string | null;
  sha256: string | null;
  embedding_model: string; // model the chunks were embedded with (search compares same-model only)
  dim: number;
  ingested_at: string;
}

export interface NotebookChunk {
  id: string;
  document_id: string;
  ord: number;
  text: string;
  token_count: number;
}

// A retrieval hit returned by searchNotebook / the notebook.search tool.
export interface NotebookSearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  ord: number;
  text: string;
  score: number; // cosine similarity, 0..1
}

// One entry in the OpenEdu Library manifest (index.json hosted on the static site). The app fetches
// the manifest, matches a query against these fields (lexical), then fetches the resource body by
// `path`. Kept small so the manifest stays a few KB even with a large library.
export interface LibraryEntry {
  id: string;          // stable id, e.g. "chemistry/periodic-table"
  title: string;       // human title, shown in the source chip
  aliases: string[];   // alternate names the lexical matcher scores against
  tags: string[];      // topic keywords
  subject: string;     // coarse subject bucket
  summary: string;     // one-line description
  path: string;        // relative path to the resource body, e.g. "resources/chemistry/periodic-table.md"
  asset?: string;      // OPTIONAL relative path to an authored SVG "raw form", e.g. "assets/chemistry/periodic-table.svg"
  // OPTIONAL discriminative terms from the card BODY, emitted by build-index.mjs as a compact
  // "term:weight" string. Ranking never reads a body at runtime — 154KB of authored prose was
  // invisible to retrieval — so the builder distils it once. Buckets use absolute df thresholds,
  // never per-corpus quantiles, so a term's weight means the same thing in the bundled core and in
  // a separately-built pack. Absent on an older manifest, which scores exactly as before.
  body_terms?: string;   // compact "term:weight term:weight", weight 3|2|1
}

// The result the library.search tool yields. `text` is the matched resource's cleaned, capped body;
// `related` lists titles of near-matches so the tutor can mention alternatives without a second hop.
export interface LibrarySearchResult {
  found: boolean;
  id: string; // the matched card's stable id (e.g. "chemistry/periodic-table") — deep-link target for the Resources tab
  title: string;
  source_url: string;
  text: string;
  related: string[];
}

// The result the library.lookup tool yields — ONE deterministic record (or a computed value) from a
// structured dataset that's too big for a card. `computed` true ⇒ a pure local calc (base conversion,
// ASCII, regular-verb conjugation) with no `verified` date; `card_id` deep-links the chip to a companion
// browse card when one exists. Distinct from LibrarySearchResult (which returns a whole card body).
export interface LibraryLookupResult {
  found: boolean;
  dataset: string;     // echoes the queried dataset enum value (chip label + eval assertions)
  title: string;       // human label of the matched record
  text: string;        // the deterministic answer body the model grounds in
  computed: boolean;   // true for number_base / ascii_table / verb_conjugation
  source: string;      // citation ("US Presidents dataset, OpenEdu Library" / "computed locally")
  verified?: string;   // "as of" YYYY-MM for DATA datasets (omitted for computed)
  card_id?: string;    // OPTIONAL manifest id for a companion browse card → enables the deep-link chip
  related: string[];   // near-miss record labels (mirrors LibrarySearchResult.related)
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

// A spaced-repetition flashcard (migration v10). Scheduling fields are SM-2-lite (see src/lib/srs.ts):
// `ease` (factor, floor 1.3), `interval_days`, `reps`, `lapses`, `due_at`. `source` records how the
// card was minted — manual (student), tutor (flashcard.create tool), or quiz_miss (auto-mint).
export type FlashcardSource = "manual" | "tutor" | "quiz_miss";

export interface Flashcard {
  id: string;
  course_id: string;
  subtopic_id: string | null;
  level: number | null;
  front: string;
  back: string;
  source: FlashcardSource;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
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
  // The context window to REQUEST, in tokens — min(the model's own maximum, the user's setting).
  // Populated by the caller from detectModelProfile. Sent to Ollama as `num_ctx`; when absent the
  // server picks its own default and truncates the front of the prompt silently, which is the bug
  // this field exists to prevent (#86). Ignored by cloud providers, which size their own windows.
  contextTokens?: number;
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
