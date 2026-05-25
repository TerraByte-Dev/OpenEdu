import Database from "@tauri-apps/plugin-sql";
import type { Course, Syllabus, Note, ChatMessage, QuizAttempt, QuizQuestion, UserProgress, Lesson, NotebookDocument, NotebookFolder } from "../types";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:openedu.db");
  }
  return db;
}

function uuid(): string {
  return crypto.randomUUID();
}

// Courses
export async function getCourses(): Promise<Course[]> {
  const d = await getDb();
  return await d.select("SELECT * FROM courses ORDER BY updated_at DESC");
}

export async function getCourse(id: string): Promise<Course | null> {
  const d = await getDb();
  const rows: Course[] = await d.select("SELECT * FROM courses WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createCourse(title: string, topic: string, spriteId?: string | null): Promise<Course> {
  const d = await getDb();
  const id = uuid();
  // current_level defaults to 1.0 (the first learning level in the new 1..6 scheme).
  // We set it explicitly here rather than via the migration 1 default (which would
  // change a previously-applied migration and trip the plugin's hash check).
  // sprite_id (Phase 4b) is the chosen persona; NULL when no persona is picked.
  await d.execute(
    "INSERT INTO courses (id, title, topic, current_level, sprite_id) VALUES ($1, $2, $3, 1.0, $4)",
    [id, title, topic, spriteId ?? null]
  );
  return (await getCourse(id))!;
}

// Mid-course persona switch (Phase 4b). Persona is orthogonal to progress/knowledge — switching
// only changes the <persona> identity slot, never the concept ledger or learning profile.
export async function setCourseSprite(courseId: string, spriteId: string | null): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE courses SET sprite_id = $1, updated_at = datetime('now') WHERE id = $2",
    [spriteId, courseId],
  );
}

// Insert a course only if absent (idempotent). Used by the eval harness to satisfy the course_id
// foreign keys when seeding its sentinel course — a fake course_id otherwise throws FK 787.
export async function ensureCourse(id: string, title: string, topic: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "INSERT OR IGNORE INTO courses (id, title, topic, current_level) VALUES ($1, $2, $3, 1.0)",
    [id, title, topic]
  );
}

export async function deleteCourse(id: string): Promise<void> {
  const d = await getDb();
  // Delete in dependency order
  await d.execute("DELETE FROM quiz_questions WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE course_id = $1)", [id]);
  await d.execute("DELETE FROM quiz_attempts WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM chat_messages WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notes WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notebook_embeddings WHERE chunk_id IN (SELECT c.id FROM notebook_chunks c JOIN notebook_documents nd ON c.document_id = nd.id WHERE nd.course_id = $1)", [id]);
  await d.execute("DELETE FROM notebook_chunks WHERE document_id IN (SELECT id FROM notebook_documents WHERE course_id = $1)", [id]);
  await d.execute("DELETE FROM notebook_documents WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notebook_folders WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM tutor_instructions WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM syllabuses WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM user_progress WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM courses WHERE id = $1", [id]);
}

export async function updateCourseLevel(id: string, level: number): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE courses SET current_level = $1, updated_at = datetime('now') WHERE id = $2",
    [level, id]
  );
}

export async function updateGenerationState(id: string, state: string | null): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE courses SET generation_state = $1, updated_at = datetime('now') WHERE id = $2",
    [state, id]
  );
}

export async function updateCourseStatus(id: string, status: "active" | "completed" | "archived"): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE courses SET status = $1, updated_at = datetime('now') WHERE id = $2",
    [status, id]
  );
}

// Syllabuses
export async function getSyllabuses(courseId: string): Promise<Syllabus[]> {
  const d = await getDb();
  const rows: Array<Record<string, unknown>> = await d.select(
    "SELECT * FROM syllabuses WHERE course_id = $1 ORDER BY level ASC",
    [courseId]
  );
  return rows.map(parseSyllabus);
}

export async function getSyllabus(courseId: string, level: number): Promise<Syllabus | null> {
  const d = await getDb();
  const rows: Array<Record<string, unknown>> = await d.select(
    "SELECT * FROM syllabuses WHERE course_id = $1 AND level = $2",
    [courseId, level]
  );
  return rows[0] ? parseSyllabus(rows[0]) : null;
}

export async function saveSyllabus(syllabus: Omit<Syllabus, "id" | "generated_at">): Promise<void> {
  const d = await getDb();
  const existing: Array<{ id: string }> = await d.select(
    "SELECT id FROM syllabuses WHERE course_id = $1 AND level = $2",
    [syllabus.course_id, syllabus.level]
  );
  if (existing.length > 0) {
    await d.execute(
      `UPDATE syllabuses SET title = $1, description = $2, learning_objectives = $3, subtopics = $4, assessment_criteria = $5, estimated_hours = $6
       WHERE id = $7`,
      [
        syllabus.title,
        syllabus.description,
        JSON.stringify(syllabus.learning_objectives),
        JSON.stringify(syllabus.subtopics),
        JSON.stringify(syllabus.assessment_criteria),
        syllabus.estimated_hours,
        existing[0].id,
      ]
    );
  } else {
    const id = uuid();
    await d.execute(
      `INSERT INTO syllabuses (id, course_id, level, title, description, learning_objectives, subtopics, assessment_criteria, estimated_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        syllabus.course_id,
        syllabus.level,
        syllabus.title,
        syllabus.description,
        JSON.stringify(syllabus.learning_objectives),
        JSON.stringify(syllabus.subtopics),
        JSON.stringify(syllabus.assessment_criteria),
        syllabus.estimated_hours,
      ]
    );
  }
}

function parseSyllabus(row: Record<string, unknown>): Syllabus {
  return {
    ...row,
    learning_objectives: JSON.parse(row.learning_objectives as string || "[]"),
    subtopics: JSON.parse(row.subtopics as string || "[]"),
    assessment_criteria: JSON.parse(row.assessment_criteria as string || "[]"),
  } as Syllabus;
}

// Tutor Instructions
export async function saveTutorInstruction(
  courseId: string,
  type: string,
  content: string
): Promise<void> {
  const d = await getDb();
  // Check if one already exists for this course+type, update it; otherwise insert
  const existing: Array<{ id: string }> = await d.select(
    "SELECT id FROM tutor_instructions WHERE course_id = $1 AND instruction_type = $2",
    [courseId, type]
  );
  if (existing.length > 0) {
    await d.execute(
      "UPDATE tutor_instructions SET content = $1, version = version + 1 WHERE id = $2",
      [content, existing[0].id]
    );
  } else {
    const id = uuid();
    await d.execute(
      "INSERT INTO tutor_instructions (id, course_id, instruction_type, content) VALUES ($1, $2, $3, $4)",
      [id, courseId, type, content]
    );
  }
}

export async function getTutorInstructions(courseId: string): Promise<Record<string, string>> {
  const d = await getDb();
  const rows: Array<{ instruction_type: string; content: string }> = await d.select(
    "SELECT instruction_type, content FROM tutor_instructions WHERE course_id = $1",
    [courseId]
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.instruction_type] = row.content;
  }
  return result;
}

// Notes. Phase 3 widened the vault to course-wide: omit `level` to get every note in the
// course (the default for the Obsidian-like NotebookTab); pass `level` for the legacy
// per-unit view. Existing callers that pass a level keep working unchanged.
export async function getNotes(courseId: string, level?: number): Promise<Note[]> {
  const d = await getDb();
  if (level === undefined) {
    return await d.select(
      "SELECT * FROM notes WHERE course_id = $1 ORDER BY sort_order ASC, updated_at DESC",
      [courseId]
    );
  }
  return await d.select(
    "SELECT * FROM notes WHERE course_id = $1 AND level = $2 ORDER BY sort_order ASC",
    [courseId, level]
  );
}

export async function createNote(courseId: string, title: string, content: string, level: number, folderId: string | null = null): Promise<Note> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notes (id, course_id, level, title, content, folder_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, courseId, level, title, content, folderId]
  );
  const rows: Note[] = await d.select("SELECT * FROM notes WHERE id = $1", [id]);
  return rows[0];
}

export async function updateNote(id: string, title: string, content: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE notes SET title = $1, content = $2, updated_at = datetime('now') WHERE id = $3",
    [title, content, id]
  );
}

export async function deleteNote(id: string): Promise<void> {
  const d = await getDb();
  await deleteNotebookDocumentByNote(id); // unified vault: a note owns its search-index entry
  await d.execute("DELETE FROM notes WHERE id = $1", [id]);
}

export async function moveNoteToFolder(noteId: string, folderId: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE notes SET folder_id = $1, updated_at = datetime('now') WHERE id = $2", [folderId, noteId]);
}

// ── Notebook folders (Phase 3 — nested vault tree) ──────────────────────────
export async function getFolders(courseId: string): Promise<NotebookFolder[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM notebook_folders WHERE course_id = $1 ORDER BY sort_order ASC, name ASC",
    [courseId]
  );
}

export async function createFolder(courseId: string, name: string, parentId: string | null = null): Promise<NotebookFolder> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notebook_folders (id, course_id, name, parent_id) VALUES ($1, $2, $3, $4)",
    [id, courseId, name, parentId]
  );
  const rows: NotebookFolder[] = await d.select("SELECT * FROM notebook_folders WHERE id = $1", [id]);
  return rows[0];
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE notebook_folders SET name = $1 WHERE id = $2", [name, id]);
}

// Delete a folder, reparenting its child folders + notes to its own parent (never cascade-delete
// the student's notes).
export async function deleteFolder(id: string): Promise<void> {
  const d = await getDb();
  const rows: NotebookFolder[] = await d.select("SELECT * FROM notebook_folders WHERE id = $1", [id]);
  const parent = rows[0]?.parent_id ?? null;
  await d.execute("UPDATE notebook_folders SET parent_id = $1 WHERE parent_id = $2", [parent, id]);
  await d.execute("UPDATE notes SET folder_id = $1 WHERE folder_id = $2", [parent, id]);
  await d.execute("DELETE FROM notebook_folders WHERE id = $1", [id]);
}

// ── Notebook RAG (Phase 3) ──────────────────────────────────────────────────
// Storage for ingested student material. Vectors live in notebook_embeddings.vec as a
// JSON-array string (brute-force; see notebook.ts for cosine search). All CRUD goes through
// tauri-plugin-sql like the rest of this module — no native extension.

// One chunk's stored vector joined back to its document, for brute-force search.
export interface NotebookVecRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  ord: number;
  text: string;
  vec: string; // JSON-array string, parsed by searchNotebook
}

export async function findNotebookDocumentBySha(courseId: string, sha256: string): Promise<NotebookDocument | null> {
  const d = await getDb();
  const rows: NotebookDocument[] = await d.select(
    "SELECT * FROM notebook_documents WHERE course_id = $1 AND sha256 = $2 LIMIT 1",
    [courseId, sha256]
  );
  return rows[0] ?? null;
}

export async function createNotebookDocument(doc: {
  courseId: string;
  noteId?: string | null;
  title: string;
  sourceType: string;
  sourceUri?: string | null;
  sha256?: string | null;
  embeddingModel: string;
  dim: number;
}): Promise<string> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notebook_documents (id, course_id, note_id, title, source_type, source_uri, sha256, embedding_model, dim) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, doc.courseId, doc.noteId ?? null, doc.title, doc.sourceType, doc.sourceUri ?? null, doc.sha256 ?? null, doc.embeddingModel, doc.dim]
  );
  return id;
}

// Insert one chunk plus its embedding (vec already JSON-stringified by the caller).
export async function createNotebookChunk(chunk: {
  documentId: string;
  ord: number;
  text: string;
  tokenCount: number;
  vec: string;
}): Promise<string> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notebook_chunks (id, document_id, ord, text, token_count) VALUES ($1, $2, $3, $4, $5)",
    [id, chunk.documentId, chunk.ord, chunk.text, chunk.tokenCount]
  );
  await d.execute("INSERT INTO notebook_embeddings (chunk_id, vec) VALUES ($1, $2)", [id, chunk.vec]);
  return id;
}

// Documents in a course with their chunk counts — drives the NotebookTab source list.
export async function getNotebookDocuments(courseId: string): Promise<Array<NotebookDocument & { chunk_count: number }>> {
  const d = await getDb();
  return await d.select(
    "SELECT d.*, (SELECT COUNT(*) FROM notebook_chunks c WHERE c.document_id = d.id) AS chunk_count " +
      "FROM notebook_documents d WHERE d.course_id = $1 ORDER BY d.ingested_at DESC",
    [courseId]
  );
}

// Load every chunk vector in a course for a given embedding model (brute-force search input).
// Filtering by model keeps cosine comparisons dimensionally consistent across re-embeds.
export async function loadNotebookVectors(courseId: string, embeddingModel: string): Promise<NotebookVecRow[]> {
  const d = await getDb();
  return await d.select(
    "SELECT e.chunk_id AS chunk_id, c.document_id AS document_id, d.title AS document_title, c.ord AS ord, c.text AS text, e.vec AS vec " +
      "FROM notebook_embeddings e " +
      "JOIN notebook_chunks c ON e.chunk_id = c.id " +
      "JOIN notebook_documents d ON c.document_id = d.id " +
      "WHERE d.course_id = $1 AND d.embedding_model = $2",
    [courseId, embeddingModel]
  );
}

export async function deleteNotebookDocument(documentId: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM notebook_embeddings WHERE chunk_id IN (SELECT id FROM notebook_chunks WHERE document_id = $1)", [documentId]);
  await d.execute("DELETE FROM notebook_chunks WHERE document_id = $1", [documentId]);
  await d.execute("DELETE FROM notebook_documents WHERE id = $1", [documentId]);
}

// A note's index entry (unified vault) — used to re-index on save (delete then recreate).
export async function findNotebookDocumentByNote(noteId: string): Promise<NotebookDocument | null> {
  const d = await getDb();
  const rows: NotebookDocument[] = await d.select("SELECT * FROM notebook_documents WHERE note_id = $1 LIMIT 1", [noteId]);
  return rows[0] ?? null;
}

export async function deleteNotebookDocumentByNote(noteId: string): Promise<void> {
  const doc = await findNotebookDocumentByNote(noteId);
  if (doc) await deleteNotebookDocument(doc.id);
}

// Chat Messages (level-scoped per unit)
export async function getChatMessages(courseId: string, level: number): Promise<ChatMessage[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM chat_messages WHERE course_id = $1 AND level = $2 ORDER BY created_at ASC",
    [courseId, level]
  );
}

export async function saveChatMessage(
  courseId: string,
  role: "user" | "assistant" | "system",
  content: string,
  level: number,
): Promise<ChatMessage> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO chat_messages (id, course_id, level, role, content) VALUES ($1, $2, $3, $4, $5)",
    [id, courseId, level, role, content]
  );
  const rows: ChatMessage[] = await d.select("SELECT * FROM chat_messages WHERE id = $1", [id]);
  return rows[0];
}

// Quiz
export async function createQuizAttempt(
  courseId: string,
  quizType: "quiz" | "promotion",
  level: number,
  totalQuestions: number
): Promise<QuizAttempt> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    `INSERT INTO quiz_attempts (id, course_id, quiz_type, level, total_questions)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, courseId, quizType, level, totalQuestions]
  );
  const rows: QuizAttempt[] = await d.select("SELECT * FROM quiz_attempts WHERE id = $1", [id]);
  return rows[0];
}

export async function saveQuizQuestion(q: Omit<QuizQuestion, "id">): Promise<void> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    `INSERT INTO quiz_questions (id, attempt_id, question_text, question_type, options, correct_answer, user_answer, is_correct, difficulty_level, explanation, subtopic_id, matching_pairs, blank_position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id, q.attempt_id, q.question_text, q.question_type,
      q.options ? JSON.stringify(q.options) : null,
      q.correct_answer, q.user_answer,
      q.is_correct === null ? null : q.is_correct ? 1 : 0,
      q.difficulty_level, q.explanation,
      q.subtopic_id ?? null,
      q.matching_pairs ? JSON.stringify(q.matching_pairs) : null,
      q.blank_position ?? null,
    ]
  );
}

export async function completeQuizAttempt(
  attemptId: string,
  score: number,
  correctCount: number,
  timeTaken: number
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE quiz_attempts SET score = $1, correct_count = $2, time_taken_seconds = $3, completed_at = datetime('now') WHERE id = $4`,
    [score, correctCount, timeTaken, attemptId]
  );
}

export async function getQuizAttempts(courseId: string): Promise<QuizAttempt[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM quiz_attempts WHERE course_id = $1 ORDER BY started_at DESC",
    [courseId]
  );
}

// Get the most recent completed promotion test for a given level (for cooldown checks)
export async function getLastPromotionAttempt(courseId: string, level: number): Promise<QuizAttempt | null> {
  const d = await getDb();
  const rows: QuizAttempt[] = await d.select(
    `SELECT * FROM quiz_attempts WHERE course_id = $1 AND level = $2 AND quiz_type = 'promotion' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
    [courseId, level]
  );
  return rows[0] ?? null;
}

export async function createPromotionAttempt(
  courseId: string,
  level: number,
  totalQuestions: number,
  timeLimitSeconds: number,
): Promise<QuizAttempt> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    `INSERT INTO quiz_attempts (id, course_id, quiz_type, level, total_questions, time_limit_seconds)
     VALUES ($1, $2, 'promotion', $3, $4, $5)`,
    [id, courseId, level, totalQuestions, timeLimitSeconds]
  );
  const rows: QuizAttempt[] = await d.select("SELECT * FROM quiz_attempts WHERE id = $1", [id]);
  return rows[0];
}

export async function getQuizQuestions(attemptId: string): Promise<QuizQuestion[]> {
  const d = await getDb();
  const rows: Array<Record<string, unknown>> = await d.select(
    "SELECT * FROM quiz_questions WHERE attempt_id = $1",
    [attemptId]
  );
  return rows.map((row) => ({
    ...row,
    options: row.options ? JSON.parse(row.options as string) : null,
    is_correct: row.is_correct === null ? null : row.is_correct === 1,
    matching_pairs: row.matching_pairs ? JSON.parse(row.matching_pairs as string) : null,
    blank_position: row.blank_position ?? null,
  })) as QuizQuestion[];
}

// User Progress
export async function getUserProgress(courseId: string): Promise<UserProgress | null> {
  const d = await getDb();
  const rows: Array<Record<string, unknown>> = await d.select(
    "SELECT * FROM user_progress WHERE course_id = $1",
    [courseId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...row,
    knowledge_gaps: JSON.parse(row.knowledge_gaps as string || "[]"),
  } as UserProgress;
}

export async function upsertUserProgress(
  courseId: string,
  data: { knowledge_gaps: string[]; total_quiz_score_avg: number | null },
): Promise<void> {
  const d = await getDb();
  const existing: Array<{ id: string }> = await d.select(
    "SELECT id FROM user_progress WHERE course_id = $1",
    [courseId]
  );
  const gapsJson = JSON.stringify(data.knowledge_gaps);
  if (existing.length > 0) {
    await d.execute(
      `UPDATE user_progress SET knowledge_gaps = $1, total_quiz_score_avg = $2, last_active_at = datetime('now') WHERE course_id = $3`,
      [gapsJson, data.total_quiz_score_avg, courseId]
    );
  } else {
    const id = uuid();
    await d.execute(
      `INSERT INTO user_progress (id, course_id, knowledge_gaps, total_quiz_score_avg, last_active_at) VALUES ($1, $2, $3, $4, datetime('now'))`,
      [id, courseId, gapsJson, data.total_quiz_score_avg]
    );
  }
}

export async function updateSyllabusSubtopics(courseId: string, level: number, subtopicsJson: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE syllabuses SET subtopics = $1 WHERE course_id = $2 AND level = $3",
    [subtopicsJson, courseId, level]
  );
}

export async function getTutorInstruction(courseId: string, type: string): Promise<string | null> {
  const d = await getDb();
  const rows: Array<{ content: string }> = await d.select(
    "SELECT content FROM tutor_instructions WHERE course_id = $1 AND instruction_type = $2",
    [courseId, type]
  );
  return rows[0]?.content ?? null;
}

// Lessons (user-pulled, lazy-generated, cached forever)
export async function createLesson(
  courseId: string,
  level: number,
  topic: string,
  content: string,
  subtopicId: string | null,
): Promise<Lesson> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO lessons (id, course_id, level, subtopic_id, topic_string, content) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, courseId, level, subtopicId, topic, content]
  );
  const rows: Lesson[] = await d.select("SELECT * FROM lessons WHERE id = $1", [id]);
  return rows[0];
}

export async function getLessons(courseId: string, level?: number): Promise<Lesson[]> {
  const d = await getDb();
  if (level === undefined) {
    return await d.select(
      "SELECT * FROM lessons WHERE course_id = $1 ORDER BY generated_at DESC",
      [courseId]
    );
  }
  return await d.select(
    "SELECT * FROM lessons WHERE course_id = $1 AND level = $2 ORDER BY generated_at DESC",
    [courseId, level]
  );
}

export async function getLesson(id: string): Promise<Lesson | null> {
  const d = await getDb();
  const rows: Lesson[] = await d.select("SELECT * FROM lessons WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function markLessonRead(id: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE lessons SET read_at = datetime('now') WHERE id = $1 AND read_at IS NULL",
    [id]
  );
}

export async function saveSelfExplanation(questionId: string, text: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE quiz_questions SET self_explanation = $1 WHERE id = $2",
    [text, questionId]
  );
}
