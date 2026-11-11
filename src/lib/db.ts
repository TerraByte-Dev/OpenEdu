import Database from "@tauri-apps/plugin-sql";
import type { Course, Syllabus, Note, ChatMessage, QuizAttempt, QuizQuestion, UserProgress, Lesson, Flashcard, NotebookDocument, NotebookFolder, NotebookChunkText, NotebookVecRow} from "../types";
import { enableWal, runQuickCheck, backupTo, type DbHealth, type BackupResult } from "./db-resilience";
import { canAccessCourse, type LearnerRow } from "./learners";
import { normalizeGrade, type Grade } from "./grade";
import { parseUsageMode, type UsageMode, type GroupRow } from "./usage-modes";
import type { OverviewSource } from "./teacher-overview";

// One shared open. Caching the promise (not the resolved value) stops the burst of callers at boot from
// each running Database.load, which builds a new sqlx pool and replaces the previous one every time.
let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = openDb();
    dbPromise.catch(() => { dbPromise = null; }); // a failed open is retried by the next caller
  }
  return dbPromise;
}

// Connection settings, checked against the shipped sources (tauri-plugin-sql 2.3.2, sqlx-sqlite 0.8.6):
// - The plugin opens a sqlx Pool (`Pool::connect`, wrapper.rs): up to 10 connections, idle ones closed
//   after 10 min, all recycled after 30 min (sqlx-core pool/options.rs). A PRAGMA sent from here runs
//   on ONE pooled connection and is lost when that connection is recycled, so per-connection PRAGMAs
//   cannot be set reliably from JS.
// - sqlx already sets these on every connection it opens (sqlx-sqlite options/mod.rs defaults):
//   foreign_keys=ON, busy_timeout=5s. synchronous is left at SQLite's default, FULL.
// - journal_mode=WAL is stored in the database file (sqlite.org/wal.html, "Persistence of WAL mode"),
//   so setting it once covers every connection, now and later. That is the one we set.
// - synchronous stays FULL on purpose: in WAL mode NORMAL can lose the last commits on power loss
//   (sqlite.org/pragma.html#pragma_synchronous); FULL syncs the WAL on each commit.
async function openDb(): Promise<Database> {
  const d = await Database.load("sqlite:openedu.db");
  try {
    const mode = await enableWal(d);
    if (mode !== "wal") console.warn(`[db] journal_mode is "${mode}", not wal; will retry next launch`);
  } catch (e) {
    // Entering WAL needs a moment of exclusive access. If something else holds the file, carry on in
    // the old mode; WAL is a speed and robustness gain, not something the app needs in order to work.
    console.warn("[db] could not switch to WAL; will retry next launch", e);
  }
  return d;
}

/** Boot-time integrity check. Never throws; the caller shows a warning when the result is "damaged". */
export async function checkDatabaseHealth(): Promise<DbHealth> {
  const t0 = performance.now();
  const health = await runQuickCheck(getDb);
  console.info(`[db] quick_check: ${health.status} in ${Math.round(performance.now() - t0)} ms`);
  if (health.status !== "ok") console.warn("[db] quick_check detail:", health.detail);
  return health;
}

/** Copy every table to `path` (a file the user picked in a save dialog). */
export async function backupLearnerData(path: string): Promise<BackupResult> {
  return backupTo(await getDb(), path);
}

function uuid(): string {
  return crypto.randomUUID();
}

// ── Learners (migration 13) ──────────────────────────────────────────────────
// Several learners share one PC. Every data table hangs off courses(id), and each course is stamped
// with one learner, so the course list and getCourse are the two doors to scope; everything else is
// reached through a course the active learner already owns. With no active learner (the picker is up)
// both doors are shut: getCourses returns nothing and getCourse refuses everything.
let activeLearnerId: string | null = null;

export function setActiveLearnerId(id: string | null): void {
  activeLearnerId = id;
}

export function getActiveLearnerId(): string | null {
  return activeLearnerId;
}

export async function listLearners(): Promise<LearnerRow[]> {
  const d = await getDb();
  return await d.select("SELECT * FROM learners ORDER BY created_at ASC, rowid ASC");
}

export async function createLearner(name: string, groupId: string | null = null, grade: Grade | null = null): Promise<LearnerRow> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO learners (id, name, created_at, group_id, grade) VALUES ($1, $2, datetime('now'), $3, $4)",
    [id, name.trim(), groupId, normalizeGrade(grade)],
  );
  const rows: LearnerRow[] = await d.select("SELECT * FROM learners WHERE id = $1", [id]);
  return rows[0];
}

/** Set (0 = K … 12) or clear (null) a learner's grade (migration 15, grade.ts). */
export async function setLearnerGrade(id: string, grade: Grade | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learners SET grade = $1 WHERE id = $2", [normalizeGrade(grade), id]);
}

export async function renameLearner(id: string, name: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learners SET name = $1 WHERE id = $2", [name.trim(), id]);
}

/** Set (hash + salt from learner-pin.ts) or clear (both null) a learner's PIN. */
export async function setLearnerPin(id: string, pinHash: string | null, pinSalt: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learners SET pin_hash = $1, pin_salt = $2 WHERE id = $3", [pinHash, pinSalt, id]);
}

export async function touchLearner(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learners SET last_active_at = datetime('now') WHERE id = $1", [id]);
}

/** Delete a learner and every course they own, through the same path as deleting one course. */
export async function deleteLearner(id: string): Promise<void> {
  const d = await getDb();
  const owned: Array<{ id: string }> = await d.select("SELECT id FROM courses WHERE learner_id = $1", [id]);
  for (const c of owned) await deleteCourse(c.id);
  await d.execute("DELETE FROM learners WHERE id = $1", [id]);
  if (activeLearnerId === id) activeLearnerId = null;
}

// ── Usage mode + teacher PIN (migration 14) ─────────────────────────────────
// Stored in app_config, next to the data they protect. See usage-modes.ts for the rules.

export interface UsageConfig {
  /** null = never chosen (a fresh install that has not been asked yet). */
  mode: UsageMode | null;
  /** Same record shape as a learner PIN (learner-pin.ts), or nulls when no teacher PIN is set. */
  teacher: { pin_hash: string | null; pin_salt: string | null };
}

export async function getUsageConfig(): Promise<UsageConfig> {
  const d = await getDb();
  const rows: Array<{ key: string; value: string | null }> = await d.select(
    "SELECT key, value FROM app_config WHERE key IN ('usage_mode', 'teacher_pin_hash', 'teacher_pin_salt')",
  );
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return {
    mode: parseUsageMode(get("usage_mode")),
    teacher: { pin_hash: get("teacher_pin_hash"), pin_salt: get("teacher_pin_salt") },
  };
}

/**
 * Save the mode, and the teacher PIN with it, so the two never disagree. `teacher` is the new PIN
 * record, or null to clear it (going back to "Just me"), or undefined to leave it alone. One
 * statement, so SQLite applies all of it or none of it: a failed write can never leave a class or
 * school with no teacher PIN, or "Just me" with half of one.
 */
export async function setUsageMode(
  mode: UsageMode,
  teacher?: { pin_hash: string; pin_salt: string } | null,
): Promise<void> {
  const d = await getDb();
  const upsert = "ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  if (teacher === undefined) {
    await d.execute(`INSERT INTO app_config (key, value) VALUES ('usage_mode', $1) ${upsert}`, [mode]);
    return;
  }
  await d.execute(
    `INSERT INTO app_config (key, value) VALUES ('teacher_pin_hash', $1), ('teacher_pin_salt', $2), ('usage_mode', $3) ${upsert}`,
    [teacher?.pin_hash ?? null, teacher?.pin_salt ?? null, mode],
  );
}

// ── Groups (school mode, migration 14) ──────────────────────────────────────

export async function listGroups(): Promise<GroupRow[]> {
  const d = await getDb();
  return await d.select("SELECT * FROM learner_groups ORDER BY name COLLATE NOCASE ASC");
}

export async function createGroup(name: string): Promise<GroupRow> {
  const d = await getDb();
  const id = uuid();
  await d.execute("INSERT INTO learner_groups (id, name, created_at) VALUES ($1, $2, datetime('now'))", [id, name.trim()]);
  const rows: GroupRow[] = await d.select("SELECT * FROM learner_groups WHERE id = $1", [id]);
  return rows[0];
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learner_groups SET name = $1 WHERE id = $2", [name.trim(), id]);
}

/** Delete a group. Its learners stay, in no group; nobody's data is touched. */
export async function deleteGroup(id: string): Promise<void> {
  const d = await getDb();
  // The FK says ON DELETE SET NULL; do it explicitly too so it holds even with foreign keys off.
  await d.execute("UPDATE learners SET group_id = NULL WHERE group_id = $1", [id]);
  await d.execute("DELETE FROM learner_groups WHERE id = $1", [id]);
}

export async function setLearnerGroup(learnerId: string, groupId: string | null): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE learners SET group_id = $1 WHERE id = $2", [groupId, learnerId]);
}

/**
 * Raw rows for the teacher overview, across EVERY learner. This deliberately bypasses the
 * active-learner scope above, so only the teacher view may call it, and only after the teacher PIN.
 * Read-only; teacher-overview.ts buildOverviewRows turns it into the table and the CSV.
 */
export async function getTeacherOverviewSource(): Promise<OverviewSource> {
  const d = await getDb();
  return {
    learners: await listLearners(),
    groups: await listGroups(),
    courses: await d.select("SELECT id, title, learner_id, current_level, updated_at FROM courses"),
    syllabuses: await d.select("SELECT course_id, subtopics FROM syllabuses"),
    progress: await d.select("SELECT course_id, last_active_at FROM user_progress"),
  };
}

// Courses
export async function getCourses(): Promise<Course[]> {
  if (!activeLearnerId) return [];
  const d = await getDb();
  return await d.select(
    "SELECT * FROM courses WHERE learner_id = $1 ORDER BY updated_at DESC",
    [activeLearnerId],
  );
}

// Refuses (returns null for) a course owned by another learner, or any course while no learner is
// active. Every course id that arrives from outside a course-scoped list goes through here.
export async function getCourse(id: string): Promise<Course | null> {
  const d = await getDb();
  const rows: Course[] = await d.select("SELECT * FROM courses WHERE id = $1", [id]);
  return canAccessCourse(rows[0], activeLearnerId) ? rows[0] : null;
}

export async function createCourse(title: string, topic: string, spriteId?: string | null): Promise<Course> {
  if (!activeLearnerId) throw new Error("No active learner: pick a learner before creating a course");
  const d = await getDb();
  const id = uuid();
  // current_level defaults to 1.0 (the first learning level in the new 1..6 scheme).
  // We set it explicitly here rather than via the migration 1 default (which would
  // change a previously-applied migration and trip the plugin's hash check).
  // sprite_id (Phase 4b) is the chosen persona; NULL when no persona is picked.
  await d.execute(
    "INSERT INTO courses (id, title, topic, current_level, sprite_id, learner_id) VALUES ($1, $2, $3, 1.0, $4, $5)",
    [id, title, topic, spriteId ?? null, activeLearnerId]
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
  // Stamped with the active learner like any other course, so the eval's sentinel stays in the
  // session that ran it.
  await d.execute(
    "INSERT OR IGNORE INTO courses (id, title, topic, current_level, learner_id) VALUES ($1, $2, $3, 1.0, $4)",
    [id, title, topic, activeLearnerId]
  );
}

export async function deleteCourse(id: string): Promise<void> {
  const d = await getDb();
  // Delete in dependency order
  await d.execute("DELETE FROM quiz_questions WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE course_id = $1)", [id]);
  await d.execute("DELETE FROM quiz_attempts WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM chat_messages WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM chat_threads WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notes WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notebook_embeddings WHERE chunk_id IN (SELECT c.id FROM notebook_chunks c JOIN notebook_documents nd ON c.document_id = nd.id WHERE nd.course_id = $1)", [id]);
  await d.execute("DELETE FROM notebook_chunks WHERE document_id IN (SELECT id FROM notebook_documents WHERE course_id = $1)", [id]);
  await d.execute("DELETE FROM notebook_documents WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM notebook_folders WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM tutor_instructions WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM syllabuses WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM lessons WHERE course_id = $1", [id]);
  await d.execute("DELETE FROM flashcards WHERE course_id = $1", [id]);
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
  /** Base64 of the raw f32 buffer — see vec-codec.ts for why not JSON. */
  vecB64: string;
}): Promise<string> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO notebook_chunks (id, document_id, ord, text, token_count) VALUES ($1, $2, $3, $4, $5)",
    [id, chunk.documentId, chunk.ord, chunk.text, chunk.tokenCount]
  );
  await d.execute("INSERT INTO notebook_embeddings (chunk_id, vec, vec_b64) VALUES ($1, $2, $3)",
    // `vec` stays populated because migration 7 declared it NOT NULL and migrations may not be
    // edited once shipped. It is written as "" — the reader prefers vec_b64 and only falls back
    // to JSON for rows written before migration 12.
    [id, "", chunk.vecB64]);
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
// Vectors ONLY — no chunk text, no document join.
//
// The old query selected `c.text` and `d.title` alongside every vector, so ranking shipped the
// entire course's prose across IPC on every keystroke to score it and then throw all but three
// rows away. Text is now fetched for the winners, after ranking, by `getChunkTexts`.
export async function loadNotebookVectors(courseId: string, embeddingModel: string): Promise<NotebookVecRow[]> {
  const d = await getDb();
  return await d.select(
    "SELECT e.chunk_id AS chunk_id, e.vec AS vec, e.vec_b64 AS vec_b64 " +
      "FROM notebook_embeddings e " +
      "JOIN notebook_chunks c ON e.chunk_id = c.id " +
      "JOIN notebook_documents d ON c.document_id = d.id " +
      "WHERE d.course_id = $1 AND d.embedding_model = $2",
    [courseId, embeddingModel]
  );
}

/** Text and provenance for the handful of chunks that actually won. */
export async function getChunkTexts(chunkIds: string[]): Promise<NotebookChunkText[]> {
  if (chunkIds.length === 0) return [];
  const d = await getDb();
  const holes = chunkIds.map((_, i) => `$${i + 1}`).join(",");
  return await d.select(
    "SELECT c.id AS chunk_id, c.document_id AS document_id, d.title AS document_title, " +
      "c.ord AS ord, c.text AS text " +
      "FROM notebook_chunks c JOIN notebook_documents d ON c.document_id = d.id " +
      `WHERE c.id IN (${holes})`,
    chunkIds
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

// ── Chat threads ─────────────────────────────────────────────────────────────
// A thread is one named conversation inside a (course, level). Before this there was exactly ONE
// endless transcript per level, so an earlier topic got buried and — once past the read cap — was
// effectively unreachable. Threads are scoped to (course, level) rather than to the course alone so
// the syllabus context a turn is built against always matches the thread it lives in.

export interface ChatThread {
  id: string;
  course_id: string;
  level: number;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Newest activity first — the order a conversation list is useful in. */
export async function listChatThreads(courseId: string, level: number): Promise<ChatThread[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM chat_threads WHERE course_id = $1 AND level = $2 ORDER BY updated_at DESC, rowid DESC",
    [courseId, level],
  );
}

export async function createChatThread(courseId: string, level: number, title = ""): Promise<ChatThread> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO chat_threads (id, course_id, level, title) VALUES ($1, $2, $3, $4)",
    [id, courseId, level, title],
  );
  const rows: ChatThread[] = await d.select("SELECT * FROM chat_threads WHERE id = $1", [id]);
  return rows[0];
}

export async function renameChatThread(threadId: string, title: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE chat_threads SET title = $1, updated_at = datetime('now') WHERE id = $2",
    [title, threadId],
  );
}

/** Bumped on every send so the list stays ordered by real activity, not creation. */
export async function touchChatThread(threadId: string): Promise<void> {
  const d = await getDb();
  await d.execute("UPDATE chat_threads SET updated_at = datetime('now') WHERE id = $1", [threadId]);
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM chat_messages WHERE thread_id = $1", [threadId]);
  await d.execute("DELETE FROM chat_threads WHERE id = $1", [threadId]);
}

// Chat Messages (level-scoped per unit)
//
// Capped at the most recent CHAT_HISTORY_LIMIT messages (#86). This query used to be unbounded, and
// ChatTab spreads its result verbatim into every request — so a long-running course sent its entire
// transcript to the model on every turn and paid the IPC + JSON cost of loading it on every mount.
// The kernel's budget would trim it anyway; this stops it being read off disk in the first place.
//
// PRODUCT DECISION, not just a prompt-cost cap: this is the ONLY loader for the chat transcript, so
// the limit is also the student's scrollback window. Messages older than the most recent 200 in a
// course/level disappear from the UI on the next mount. They are not deleted — a "load earlier"
// affordance or a separate, larger UI read would restore them. 200 is roughly a term of tutoring at
// one session a week; revisit if that proves short.
// The inner query takes the NEWEST rows, the outer one restores chronological order.
export const CHAT_HISTORY_LIMIT = 200;

export async function getChatMessages(threadId: string): Promise<ChatMessage[]> {
  const d = await getDb();
  // Order by rowid, NOT created_at. `created_at` defaults to datetime('now') — SECOND granularity —
  // and a question plus its reply routinely land in the same second, so created_at alone leaves
  // their order undefined and any tiebreak on `id` sorts by UUID, i.e. at random. Swapping a user
  // message with its assistant reply corrupts the transcript the model reads on every later turn.
  // rowid is monotonic in insertion order on this table (TEXT primary key, not WITHOUT ROWID), which
  // is exactly the chronological order we want. It is aliased because `SELECT *` from a subquery
  // does not expose the implicit rowid to the outer query; `_rid` rides along unused on each row.
  return await d.select(
    `SELECT * FROM (
       SELECT rowid AS _rid, * FROM chat_messages WHERE thread_id = $1
       ORDER BY _rid DESC LIMIT $2
     ) ORDER BY _rid ASC`,
    [threadId, CHAT_HISTORY_LIMIT]
  );
}

export async function saveChatMessage(
  courseId: string,
  role: "user" | "assistant" | "system",
  content: string,
  level: number,
  threadId: string,
): Promise<ChatMessage> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    "INSERT INTO chat_messages (id, course_id, level, role, content, thread_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, courseId, level, role, content, threadId]
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

// Returns the generated row id so the caller can attach a self-explanation typed after answering.
export async function saveQuizQuestion(q: Omit<QuizQuestion, "id">): Promise<string> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    `INSERT INTO quiz_questions (id, attempt_id, question_text, question_type, options, correct_answer, user_answer, is_correct, difficulty_level, explanation, subtopic_id, matching_pairs, blank_position, self_explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id, q.attempt_id, q.question_text, q.question_type,
      q.options ? JSON.stringify(q.options) : null,
      q.correct_answer, q.user_answer,
      q.is_correct === null ? null : q.is_correct ? 1 : 0,
      q.difficulty_level, q.explanation,
      q.subtopic_id ?? null,
      q.matching_pairs ? JSON.stringify(q.matching_pairs) : null,
      q.blank_position ?? null,
      q.self_explanation ?? null,
    ]
  );
  return id;
}

// Self-explanation effect (Chi 1989): the student's own "why is that the answer" written after a
// quiz question is graded. Captured separately because the row is saved on answer, before they type.
export async function updateQuizQuestionSelfExplanation(id: string, text: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    "UPDATE quiz_questions SET self_explanation = $1 WHERE id = $2",
    [text, id]
  );
}

// The spaced "review pool": previously-missed questions for a course (most-recent first, deduped by
// question text). Re-posed alongside fresh questions in study quizzes for retrieval practice.
export async function getReviewPoolQuestions(courseId: string, limit: number): Promise<QuizQuestion[]> {
  if (limit <= 0) return [];
  const d = await getDb();
  const rows: Array<Record<string, unknown>> = await d.select(
    `SELECT qq.* FROM quiz_questions qq
       JOIN quiz_attempts qa ON qq.attempt_id = qa.id
      WHERE qa.course_id = $1 AND qq.is_correct = 0
      ORDER BY qa.started_at DESC
      LIMIT $2`,
    [courseId, limit * 4] // overfetch so dedup can still reach `limit`
  );
  const mapped = rows.map((row) => ({
    ...row,
    options: row.options ? JSON.parse(row.options as string) : null,
    is_correct: row.is_correct === null ? null : row.is_correct === 1,
    matching_pairs: row.matching_pairs ? JSON.parse(row.matching_pairs as string) : null,
    blank_position: row.blank_position ?? null,
  })) as QuizQuestion[];

  const seen = new Set<string>();
  const out: QuizQuestion[] = [];
  for (const q of mapped) {
    const key = q.question_text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
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

// Update one quiz_questions row's grade after deferred end-of-test grading (issue #83): free-text
// answers are recorded with is_correct = null during the test, then resolved here at finish.
export async function updateQuizQuestionGrade(id: string, isCorrect: boolean): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE quiz_questions SET is_correct = $1 WHERE id = $2`,
    [isCorrect ? 1 : 0, id]
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
  data: { knowledge_gaps: string[]; total_quiz_score_avg: number | null; streak_days?: number },
): Promise<void> {
  const d = await getDb();
  const existing: Array<{ id: string }> = await d.select(
    "SELECT id FROM user_progress WHERE course_id = $1",
    [courseId]
  );
  const gapsJson = JSON.stringify(data.knowledge_gaps);
  const streak = data.streak_days ?? 0;
  if (existing.length > 0) {
    await d.execute(
      `UPDATE user_progress SET knowledge_gaps = $1, total_quiz_score_avg = $2, streak_days = $3, last_active_at = datetime('now') WHERE course_id = $4`,
      [gapsJson, data.total_quiz_score_avg, streak, courseId]
    );
  } else {
    const id = uuid();
    await d.execute(
      `INSERT INTO user_progress (id, course_id, knowledge_gaps, total_quiz_score_avg, streak_days, last_active_at) VALUES ($1, $2, $3, $4, $5, datetime('now'))`,
      [id, courseId, gapsJson, data.total_quiz_score_avg, streak]
    );
  }
}

// Per-subtopic accuracy across all of a course's answered quiz questions (read-only aggregate; the
// progress dashboard's heatmap). Returns one row per tagged subtopic with correct/total counts.
export async function getSubtopicAccuracy(courseId: string): Promise<Array<{ subtopic_id: string; correct: number; total: number }>> {
  const d = await getDb();
  const rows: Array<{ subtopic_id: string; correct: number; total: number }> = await d.select(
    `SELECT qq.subtopic_id as subtopic_id,
            SUM(CASE WHEN qq.is_correct = 1 THEN 1 ELSE 0 END) as correct,
            COUNT(*) as total
       FROM quiz_questions qq JOIN quiz_attempts qa ON qq.attempt_id = qa.id
      WHERE qa.course_id = $1 AND qq.subtopic_id IS NOT NULL AND qq.is_correct IS NOT NULL
      GROUP BY qq.subtopic_id`,
    [courseId]
  );
  return rows.map((r) => ({ subtopic_id: r.subtopic_id, correct: Number(r.correct), total: Number(r.total) }));
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

// Flashcards (SRS, migration v10). Scheduling fields are written by src/lib/srs.ts via
// updateFlashcardAfterReview; new cards start due-now (the migration default) so they enter the
// first review session.
export async function createFlashcard(input: {
  courseId: string;
  front: string;
  back: string;
  subtopicId?: string | null;
  level?: number | null;
  source?: Flashcard["source"];
}): Promise<Flashcard> {
  const d = await getDb();
  const id = uuid();
  await d.execute(
    `INSERT INTO flashcards (id, course_id, subtopic_id, level, front, back, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.courseId, input.subtopicId ?? null, input.level ?? null, input.front, input.back, input.source ?? "manual"]
  );
  return (await getFlashcard(id))!;
}

export async function getFlashcard(id: string): Promise<Flashcard | null> {
  const d = await getDb();
  const rows: Flashcard[] = await d.select("SELECT * FROM flashcards WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getFlashcards(courseId: string): Promise<Flashcard[]> {
  const d = await getDb();
  return await d.select("SELECT * FROM flashcards WHERE course_id = $1 ORDER BY created_at DESC", [courseId]);
}

// Cards due for review at `nowIso` (ISO timestamp), soonest-due first.
export async function getDueFlashcards(courseId: string, nowIso: string, limit = 50): Promise<Flashcard[]> {
  const d = await getDb();
  return await d.select(
    "SELECT * FROM flashcards WHERE course_id = $1 AND due_at <= $2 ORDER BY due_at ASC LIMIT $3",
    [courseId, nowIso, limit]
  );
}

export async function countDueFlashcards(courseId: string, nowIso: string): Promise<number> {
  const d = await getDb();
  const rows: Array<{ n: number }> = await d.select(
    "SELECT COUNT(*) as n FROM flashcards WHERE course_id = $1 AND due_at <= $2",
    [courseId, nowIso]
  );
  return Number(rows[0]?.n ?? 0);
}

// Persist a post-review SM-2-lite schedule onto a card (also stamps last_reviewed_at + updated_at).
export async function updateFlashcardAfterReview(
  id: string,
  s: { ease: number; interval_days: number; reps: number; lapses: number; due_at: string },
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE flashcards SET ease = $1, interval_days = $2, reps = $3, lapses = $4, due_at = $5,
       last_reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = $6`,
    [s.ease, s.interval_days, s.reps, s.lapses, s.due_at, id]
  );
}

export async function deleteFlashcard(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM flashcards WHERE id = $1", [id]);
}

// Has a card with this exact front already been minted for the course? (dedup for auto-mint)
export async function flashcardExists(courseId: string, front: string): Promise<boolean> {
  const d = await getDb();
  const rows: Array<{ id: string }> = await d.select(
    "SELECT id FROM flashcards WHERE course_id = $1 AND front = $2 LIMIT 1",
    [courseId, front]
  );
  return rows.length > 0;
}
