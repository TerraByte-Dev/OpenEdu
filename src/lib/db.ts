import Database from "@tauri-apps/plugin-sql";
import type { Course, Syllabus, Note, ChatMessage, QuizAttempt, QuizQuestion } from "../types";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:terraturor.db");
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

export async function createCourse(title: string, topic: string): Promise<Course> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO courses (id, title, topic) VALUES ($1, $2, $3)",
    [id, title, topic]
  );
  return (await getCourse(id))!;
}

export async function deleteCourse(id: string): Promise<void> {
  const d = await getDb();
  // Delete in dependency order
  await d.execute("DELETE FROM quiz_questions WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE course_id = $1)", [id]);
  await d.execute("DELETE FROM quiz_attempts WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM chat_messages WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notes WHERE course_id = $1", [id]);
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

// Notes
export async function getNotes(courseId: string): Promise<Note[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM notes WHERE course_id = $1 ORDER BY sort_order ASC",
    [courseId]
  );
}

export async function createNote(courseId: string, title: string, content: string): Promise<Note> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notes (id, course_id, title, content) VALUES ($1, $2, $3, $4)",
    [id, courseId, title, content]
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
  await d.execute("DELETE FROM notes WHERE id = $1", [id]);
}

// Chat Messages
export async function getChatMessages(courseId: string): Promise<ChatMessage[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM chat_messages WHERE course_id = $1 ORDER BY created_at ASC",
    [courseId]
  );
}

export async function saveChatMessage(
  courseId: string,
  role: "user" | "assistant" | "system",
  content: string
): Promise<ChatMessage> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO chat_messages (id, course_id, role, content) VALUES ($1, $2, $3, $4)",
    [id, courseId, role, content]
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
    `INSERT INTO quiz_questions (id, attempt_id, question_text, question_type, options, correct_answer, user_answer, is_correct, difficulty_level, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, q.attempt_id, q.question_text, q.question_type,
      q.options ? JSON.stringify(q.options) : null,
      q.correct_answer, q.user_answer,
      q.is_correct === null ? null : q.is_correct ? 1 : 0,
      q.difficulty_level, q.explanation,
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
  })) as QuizQuestion[];
}
