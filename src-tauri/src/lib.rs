use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: "
                CREATE TABLE IF NOT EXISTS courses (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    current_level REAL NOT NULL DEFAULT 0.0,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS syllabuses (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    level REAL NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    learning_objectives TEXT NOT NULL DEFAULT '[]',
                    subtopics TEXT NOT NULL DEFAULT '[]',
                    assessment_criteria TEXT NOT NULL DEFAULT '[]',
                    estimated_hours INTEGER NOT NULL DEFAULT 0,
                    generated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS tutor_instructions (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    instruction_type TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    version INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    title TEXT NOT NULL DEFAULT 'Untitled',
                    content TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    parent_id TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS quiz_attempts (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    quiz_type TEXT NOT NULL DEFAULT 'quiz',
                    level REAL NOT NULL,
                    score REAL,
                    total_questions INTEGER NOT NULL DEFAULT 0,
                    correct_count INTEGER NOT NULL DEFAULT 0,
                    time_limit_seconds INTEGER,
                    time_taken_seconds INTEGER,
                    started_at TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS quiz_questions (
                    id TEXT PRIMARY KEY,
                    attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id),
                    question_text TEXT NOT NULL,
                    question_type TEXT NOT NULL DEFAULT 'multiple_choice',
                    options TEXT,
                    correct_answer TEXT NOT NULL,
                    user_answer TEXT,
                    is_correct INTEGER,
                    difficulty_level REAL NOT NULL,
                    explanation TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS user_progress (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL UNIQUE REFERENCES courses(id),
                    knowledge_gaps TEXT NOT NULL DEFAULT '[]',
                    total_quiz_score_avg REAL NOT NULL DEFAULT 0.0,
                    streak_days INTEGER NOT NULL DEFAULT 0,
                    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add level column to notes and chat_messages for unit-scoped data",
            sql: "
                ALTER TABLE notes ADD COLUMN level REAL NOT NULL DEFAULT 0.0;
                ALTER TABLE chat_messages ADD COLUMN level REAL NOT NULL DEFAULT 0.0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add subtopic_id to quiz_questions for mastery tracking",
            sql: "
                ALTER TABLE quiz_questions ADD COLUMN subtopic_id TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add matching_pairs and blank_position for diverse question types",
            sql: "
                ALTER TABLE quiz_questions ADD COLUMN matching_pairs TEXT;
                ALTER TABLE quiz_questions ADD COLUMN blank_position TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add generation_state to courses for checkpoint/resume",
            sql: "
                ALTER TABLE courses ADD COLUMN generation_state TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "lessons table + quiz self_explanation",
            sql: "
                CREATE TABLE IF NOT EXISTS lessons (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    level INTEGER NOT NULL,
                    subtopic_id TEXT,
                    topic_string TEXT NOT NULL,
                    content TEXT NOT NULL,
                    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    read_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_lessons_course_level ON lessons(course_id, level);

                ALTER TABLE quiz_questions ADD COLUMN self_explanation TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "notebook RAG: documents, chunks, embeddings (brute-force; vec as JSON-array TEXT)",
            sql: "
                CREATE TABLE IF NOT EXISTS notebook_documents (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    title TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'text',
                    source_uri TEXT,
                    sha256 TEXT,
                    embedding_model TEXT NOT NULL,
                    dim INTEGER NOT NULL DEFAULT 0,
                    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS notebook_chunks (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL REFERENCES notebook_documents(id),
                    ord INTEGER NOT NULL DEFAULT 0,
                    text TEXT NOT NULL,
                    token_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS notebook_embeddings (
                    chunk_id TEXT PRIMARY KEY REFERENCES notebook_chunks(id),
                    vec TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_nb_docs_course ON notebook_documents(course_id);
                CREATE INDEX IF NOT EXISTS idx_nb_chunks_doc ON notebook_chunks(document_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "notebook folders (nested) + link index entries to notes (unified vault)",
            sql: "
                CREATE TABLE IF NOT EXISTS notebook_folders (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    name TEXT NOT NULL,
                    parent_id TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                ALTER TABLE notes ADD COLUMN folder_id TEXT;
                ALTER TABLE notebook_documents ADD COLUMN note_id TEXT;

                CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
                CREATE INDEX IF NOT EXISTS idx_nb_docs_note ON notebook_documents(note_id);
                CREATE INDEX IF NOT EXISTS idx_nb_folders_course ON notebook_folders(course_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "course persona: sprite_id (Phase 4b; append-only, never edit v1-v8)",
            sql: "ALTER TABLE courses ADD COLUMN sprite_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "flashcards (SRS) — SM-2-lite scheduling fields (v0.2.0; append-only, never edit v1-v9)",
            sql: "
                CREATE TABLE IF NOT EXISTS flashcards (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    subtopic_id TEXT,
                    level INTEGER,
                    front TEXT NOT NULL,
                    back TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'manual',
                    ease REAL NOT NULL DEFAULT 2.5,
                    interval_days REAL NOT NULL DEFAULT 0,
                    reps INTEGER NOT NULL DEFAULT 0,
                    lapses INTEGER NOT NULL DEFAULT 0,
                    due_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_reviewed_at TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_flashcards_course_due ON flashcards(course_id, due_at);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "chat threads — named conversations per course/level (append-only, never edit v1-v10)",
            sql: "
                CREATE TABLE IF NOT EXISTS chat_threads (
                    id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL REFERENCES courses(id),
                    level REAL NOT NULL DEFAULT 0.0,
                    title TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                ALTER TABLE chat_messages ADD COLUMN thread_id TEXT;

                -- Backfill: every existing (course, level) transcript becomes one thread, so no
                -- history is stranded. The id is DERIVED rather than random precisely so this can run
                -- in pure SQL inside the migration -- a JS backfill would have to be idempotent, would
                -- run after the UI had already queried, and could half-complete. The courses guard
                -- keeps a FK violation from aborting the migration if any orphaned messages exist.
                INSERT INTO chat_threads (id, course_id, level, title, created_at, updated_at)
                SELECT 'legacy:' || course_id || ':' || level,
                       course_id,
                       level,
                       'Earlier conversation',
                       MIN(created_at),
                       MAX(created_at)
                  FROM chat_messages
                 WHERE course_id IN (SELECT id FROM courses)
                 GROUP BY course_id, level;

                UPDATE chat_messages
                   SET thread_id = 'legacy:' || course_id || ':' || level
                 WHERE thread_id IS NULL
                   AND course_id IN (SELECT id FROM courses);

                CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_chat_threads_course ON chat_threads(course_id, level, updated_at);
            ",
            kind: MigrationKind::Up,
        },
    ];

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:openedu.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    // Updater is desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
