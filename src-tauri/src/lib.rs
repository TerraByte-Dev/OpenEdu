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
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:terraturor.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
