mod corpus;
mod system;

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
        Migration {
            version: 12,
            description: "notebook vectors as base64 f32 (append-only, never edit v1-v11)",
            sql: "
                -- Vectors shipped as JSON-array TEXT: 9,495 bytes for a 768-dim f32 vs 3,072 raw,
                -- a 3.09x bloat that is also 3.09x of IPC and of JSON.parse on every single query.
                -- Retrieval loaded EVERY chunk in a course, so V8's 2^29-byte string ceiling capped
                -- the whole feature at ~47,000 chunks -- about 2,500 documents.
                --
                -- New column rather than a rewrite of `vec`: migrations are hashed and may never be
                -- edited once shipped, and a NULL here simply means \"not yet re-encoded\", which the
                -- reader falls back from. Nothing needs backfilling for correctness.
                ALTER TABLE notebook_embeddings ADD COLUMN vec_b64 TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "learner profiles: learners table + courses.learner_id (append-only, never edit v1-v12)",
            sql: "
                -- Several learners share one PC. Every data table hangs off courses(id), so scoping
                -- courses to a learner scopes everything under them.
                CREATE TABLE IF NOT EXISTS learners (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    pin_hash TEXT,
                    pin_salt TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    last_active_at TEXT
                );

                ALTER TABLE courses ADD COLUMN learner_id TEXT;

                -- One default learner owns everything that existed before profiles. The id is fixed
                -- (DEFAULT_LEARNER_ID in src/lib/learners.ts) so this runs in pure SQL, and one learner
                -- with no PIN means the app shows no picker: an existing install sees no change.
                INSERT OR IGNORE INTO learners (id, name, created_at) VALUES ('default', 'Learner 1', datetime('now'));
                UPDATE courses SET learner_id = 'default' WHERE learner_id IS NULL;

                CREATE INDEX IF NOT EXISTS idx_courses_learner ON courses(learner_id, updated_at);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "usage modes: app_config (mode + teacher PIN), learner_groups + learners.group_id (append-only, never edit v1-v13)",
            sql: "
                -- Machine-wide settings that protect learner data live next to it, not in the plugin
                -- store, so a settings export never carries them and an import cannot lower them.
                -- Keys: usage_mode ('single' | 'class' | 'school'), teacher_pin_hash, teacher_pin_salt.
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );

                -- An install that already has courses was in use before modes existed: it starts as
                -- 'Just me' without being asked. A fresh install has no row and gets the question.
                INSERT OR IGNORE INTO app_config (key, value)
                    SELECT 'usage_mode', 'single' WHERE EXISTS (SELECT 1 FROM courses);

                -- Groups (classes) for school mode. Deleting a group leaves its learners in no group.
                CREATE TABLE IF NOT EXISTS learner_groups (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                ALTER TABLE learners ADD COLUMN group_id TEXT REFERENCES learner_groups(id) ON DELETE SET NULL;

                CREATE INDEX IF NOT EXISTS idx_learners_group ON learners(group_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "learner grade: learners.grade (append-only, never edit v1-v14)",
            sql: "
                -- A learner's school grade: 0 = kindergarten, 1-12 = that grade, NULL = not set.
                -- Existing learners get NULL, which leaves the tutor exactly as it was (src/lib/grade.ts).
                ALTER TABLE learners ADD COLUMN grade INTEGER CHECK (grade IS NULL OR (grade BETWEEN 0 AND 12));
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "early-learner attempts: early_attempts (append-only, never edit v1-v15)",
            sql: "
                -- One row per tap in the K-1 activities (src/lib/early/). Mastery is computed from these
                -- rows by code (engine.ts skillProgress), so nothing else is stored. skill_id and item_id
                -- are the stable ids in src/lib/early/packs.ts. Deleting a learner deletes their rows.
                CREATE TABLE IF NOT EXISTS early_attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
                    skill_id TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
                    first_try INTEGER NOT NULL CHECK (first_try IN (0, 1)),
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                -- Every read is one learner's rows in the order they were made.
                CREATE INDEX IF NOT EXISTS idx_early_attempts_learner ON early_attempts(learner_id, id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "early-learner attempts: the tapped choice (append-only, never edit v1-v16)",
            sql: "
                -- choiceKey() of the choice the child tapped ('color:pink', 'n:14', 'dots:14',
                -- 'shape:square'), so the grown-ups view can say what a wrong first try was mixed up with
                -- (src/lib/early/report.ts hardOnes). NULL on rows stored before this version.
                ALTER TABLE early_attempts ADD COLUMN choice TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "learning-record capture (append-only, never edit v1-v17)",
            sql: "
                -- What the learning record (#258) needs and the app did not store. Nothing here is
                -- backfilled: rows from before record_capture_since keep the record's proxy labels.

                -- Counted active minutes per learner per local day (src/lib/record/active-minute.ts).
                -- last_tick_at stops a second window from counting the same minute twice.
                CREATE TABLE IF NOT EXISTS learner_days (
                    learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
                    day TEXT NOT NULL,
                    minutes INTEGER NOT NULL DEFAULT 0,
                    last_tick_at TEXT,
                    PRIMARY KEY (learner_id, day)
                );

                -- Skill status changes that do not come from a tagged quiz question: the tutor's
                -- progress.mark_mastered tool, and keyword-matched untagged questions. Tagged quiz
                -- evidence is replayed from quiz_questions, so it is not duplicated here.
                CREATE TABLE IF NOT EXISTS subtopic_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                    level INTEGER NOT NULL,
                    subtopic_id TEXT NOT NULL,
                    event TEXT NOT NULL CHECK (event IN ('practiced', 'mastered', 'review_needed', 'review_cleared')),
                    source TEXT NOT NULL CHECK (source IN ('tutor', 'keyword')),
                    correct INTEGER,
                    total INTEGER,
                    attempt_id TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_subtopic_events_course ON subtopic_events(course_id, created_at);

                -- One row per flashcard review. flashcards.last_reviewed_at is overwritten each time.
                -- card_id has no foreign key on purpose: deleting a card later keeps its review history.
                -- The rows go with their course.
                CREATE TABLE IF NOT EXISTS flashcard_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_id TEXT NOT NULL,
                    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                    grade TEXT NOT NULL,
                    reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_course ON flashcard_reviews(course_id, reviewed_at);

                -- Level tests: pass/fail and the review-section percent. NULL before v18.
                ALTER TABLE quiz_attempts ADD COLUMN passed INTEGER;
                ALTER TABLE quiz_attempts ADD COLUMN review_score REAL;
                -- How each answer was marked: 'key' (compared with the answer key), 'exact' (string or
                -- number match), 'model', 'fallback' (the grader failed and the answer was passed
                -- leniently) or 'unanswered' (a timed-out level test). NULL before v18.
                ALTER TABLE quiz_questions ADD COLUMN graded_by TEXT;
                -- 'learner', 'import' or 'tutor'. NULL before v18.
                ALTER TABLE notes ADD COLUMN origin TEXT;
                -- A label chosen from a fixed list in the app. NULL = not set.
                ALTER TABLE courses ADD COLUMN subject TEXT;
                -- Who reads the record ('self' or 'guided'; NULL = ask) and the school-year start ('MM-DD').
                ALTER TABLE learners ADD COLUMN record_voice TEXT CHECK (record_voice IS NULL OR record_voice IN ('self', 'guided'));
                ALTER TABLE learners ADD COLUMN record_year_start TEXT;

                INSERT OR IGNORE INTO app_config (key, value) VALUES ('record_capture_since', datetime('now'));
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "saved monthly records (append-only, never edit v1-v18)",
            sql: "
                -- Each learner's learning record (#258) for a month that has ended, saved on the first
                -- launch after it ends (and on Save or CSV of an ended month not saved yet), so deleting
                -- a course or regenerating a level later cannot rewrite it. body_json holds counts,
                -- titles, dates and statuses only: the learner's own words are read live, never saved.
                -- Deleting a learner deletes their saved months; deleting a course does not.
                CREATE TABLE IF NOT EXISTS monthly_records (
                    learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
                    month TEXT NOT NULL,
                    format INTEGER NOT NULL,
                    body_json TEXT NOT NULL,
                    saved_at TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (learner_id, month)
                );
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
        .plugin(tauri_plugin_store::Builder::default().build())
        // Folder picking. Read-only corpus access lives in corpus.rs behind explicit grants rather
        // than tauri-plugin-fs, whose allow-list is fixed at build time — this product needs a root
        // the user chooses at runtime, and nothing outside it.
        .plugin(tauri_plugin_dialog::init())
        .manage(corpus::Granted::default())
        .invoke_handler(tauri::generate_handler![
            corpus::corpus_grant,
            corpus::corpus_granted,
            corpus::corpus_list,
            corpus::corpus_read_text,
            system::system_memory_bytes,
        ]);

    // Updater is desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
