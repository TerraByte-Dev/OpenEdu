# Architecture

A tour of how OpenEdu is built, for contributors. The [README](../README.md) covers what it is and how
to use it; [CONTRIBUTING](../CONTRIBUTING.md) covers the dev workflow. This document is the "why it's
shaped this way."

## At a glance

OpenEdu is a **Tauri v2** desktop app: a **React 19 + TypeScript** frontend over a small **Rust** backend,
with **SQLite** for all persistence. It is **local-first and bring-your-own-key** — the tutor runs on a
local [Ollama](https://ollama.com/) model by default, with OpenAI and Anthropic as drop-in alternates.
The guiding constraint is **reliability on small models**. The smallest one verified end to end
(generation + tutoring) is `gemma4:e4b` (~4B effective at inference, 9.6GB on disk). The harness also
runs on `qwen3.5:0.8b` (1.0GB, with `think: false`), but its tutoring failed the held-out RAG eval
(`src/lib/eval/results/2026-11-06-heldout-dev.md`); smaller
models are untested rather than ruled out, and no hardware floor has been measured. Everything follows
from that constraint: everything the model produces is schema-enforced and validated.

## Data & storage

All state lives in **one SQLite database** — no per-course files:

```
%APPDATA%/com.terrabytesolutions.openedu/openedu.db   (Windows)
```

Tables: `courses`, `syllabuses`, `tutor_instructions`, `notes`, `notebook_folders`,
`notebook_documents` / `chunks` / `embeddings`, `chat_messages`, `quiz_questions`, `quiz_attempts`,
`user_progress`, `lessons`, `lesson_checks`, `flashcards`, `learners`, and the tables kept from removed features (below). The schema evolves through **append-only versioned migrations** (`tauri-plugin-sql`, in
`src-tauri/`). The plugin hashes each migration's SQL — **never edit a shipped migration**; add a new
version, or move the change into application code. API keys and app settings persist separately via
`@tauri-apps/plugin-store`.

**Power loss.** `getDb()` switches the file to WAL on open (`PRAGMA journal_mode=WAL`; the mode is stored
in the file, so it covers every pooled connection). Other connection settings come from sqlx on every
connection: `foreign_keys=ON`, `busy_timeout` 5 s, and `synchronous` left at SQLite's default, FULL, which
keeps each commit durable in WAL mode. Per-connection PRAGMAs sent from JS are not reliable: the plugin's
sqlx pool holds up to 10 connections and recycles them. At boot `checkDatabaseHealth()` runs
`PRAGMA quick_check` and the app shows a plain-words warning if it reports damage. **Settings → Learner
data** writes a full copy with `VACUUM INTO` through the sql plugin (no `fs` capability) and explains how to
restore it by hand. The logic is in `src/lib/db-resilience.ts` (pure, tested).

**One learner (migration 13).** OpenEdu is a solo-learner app. Each course carries a `learner_id`, and
every other table hangs off `courses(id)`, so scoping courses scopes everything. `db.ts` holds the active
learner: `getCourses` lists only that learner's courses, `createCourse` stamps them, and `getCourse`
refuses another learner's course (the guard is `canAccessCourse` in `learners.ts`). Migration 13 creates
one default learner and gives it every existing course; one learner with no PIN means no picker, so a new
install, and any install that never added a learner, opens straight into that learner. The app never
adds a learner. Store keys that remember one learner (the tour flag, the daily goal, read-aloud) go
through `learnerStoreKey` in `store-keys.ts`; the default learner keeps the bare key.

**Installs with several learners.** Earlier versions could add learners (learner profiles, then a class
or school mode with a teacher PIN). Those installs keep every learner and every course. At launch
`App.tsx` runs `learners.ts autoPickLearner`: one learner with no PIN goes straight in; anything else
shows the picker (`LearnerPicker.tsx`), which lists every learner whatever their old group, and a learner
with a PIN (`needsPin`) is entered only after `PinScreen` verifies it (PBKDF2-SHA256, `learner-pin.ts`).
That keeps learners out of each other's courses; it does not protect the database file. The titlebar
chip opens the signed-in learner's menu; `learners.ts learnerMenuActions` decides what it offers. Every
learner can switch, rename themselves, and change or remove a PIN they already have (typing it first).
Adding a first PIN and deleting yourself (while another learner is left, so a family install can come
down to one learner and then opens like any solo install) are offered only where the old
`app_config usage_mode` is not `class` or `school`: there a teacher set the learners up and nobody can
undo either any more. `db.ts getLegacyUsageMode` reads that row and nothing writes or deletes it. A
forgotten learner PIN cannot be cleared inside OpenEdu: that learner's courses stay in the file and in
every backup but can't be opened in OpenEdu (PIN resets are a TerraTutor feature).
`db-learners.test.ts` runs a class-mode database from migration 19 through these paths: every course
reachable, the PIN learner only with their PIN, the old teacher PIN opening nobody, no learner offered
delete or a new PIN (a Just me install still is), and no row changed but `last_active_at`. A data file
with no learner at all (only by hand) shows an explanation and the restore steps instead of an empty
picker. If the learner list cannot be read at launch, a
full screen says so and shows the restore steps.

**Grade (migration 15).** Each learner has `learners.grade`: 0 for kindergarten, 1-12, or NULL for not
set (every learner from before it). It is set in Settings › Name & grade for the signed-in learner, beside their name. That section
has no PIN control: a solo learner has nobody to keep out, and no reset exists. `grade.ts`
decides everything from the band (K-2, 3-5, 6-8, 9-12) in code:
`readingLevelLayer` is one `## Reading level` section that `buildSystemPrompt` puts just before the output
rules, and it is nothing when no grade is set, so that prompt is byte-identical to the one before grades
(`kernel/systemPrompt-master.test.ts` pins it against a fixture). K-2 learners get larger chat text
(`.chat-text-large` in `index.css`) and replies that read themselves aloud, a per-learner store choice
that defaults to on. Every tutor reply has a speaker button: `speech.ts` turns the saved markdown into
plain words (the same marked + math tokenizer the chat renders with; LaTeX read as words, a code block as
"Code") and picks an on-device voice, and `useReadAloud.ts` plays it through `speechSynthesis`, one reply
at a time, so it works offline with the Windows voices. Lessons, quizzes and level tests have the same
speaker button for every learner (`components/ReadAloudButton.tsx`): the lesson reader's reads the lesson,
a question's reads the question and, for multiple choice and true/false, its choices
(`speech.ts questionSpeech`; a fill-in blank is read as "blank"), never the answer key. Nothing there reads
itself. K-2 also gets the larger text there: the lesson at 1.25rem (`.lesson-text-large`), and the
question at 1.5rem with its answers, inputs and feedback at 1.25rem and 1.125rem (`QuestionRenderer`,
from the `grade` it already takes for the safety notice), from the learner's grade passed down from `App`.

**Tables kept from removed features.** The family, class and school features (usage modes, the teacher
view and its CSV, learner groups, the K-1 early-learner screens and the learning record) now live only
in TerraTutor, a separate commercial edition by TerraByte Solutions. Their migrations stay exactly as
shipped, and so do their tables and rows: `app_config` (`usage_mode`, the teacher PIN,
`record_capture_since`, `record_saved_through`), `learner_groups` and `learners.group_id` (14),
`early_attempts` (16-17), `learner_days`, `learners.record_voice` / `record_year_start` and
`courses.subject` (18) and `monthly_records` (19). OpenEdu no longer reads or writes them, except that
deleting a learner still removes their rows (ON DELETE CASCADE). Migration 18's other columns ride on
what the learner does, so OpenEdu keeps writing them: `quiz_questions.graded_by` (also read by the
review pool and the accuracy heatmap, which leave out a timed-out test's unanswered questions),
`quiz_attempts.passed` / `review_score`, `flashcard_reviews`, `subtopic_events` and `notes.origin`. Each
is one insert or one more column beside a write the app makes anyway, and it keeps a learner's history
complete if they later take their data elsewhere. Counted active minutes (`learner_days`) are no longer
written: they came from a once-a-minute timer whose only reader was the learning record.

## Repo layout

| Path | What lives there |
|---|---|
| `src/lib/` | The non-UI core (see below). The Tauri-free modules have `*.test.ts` next to them. |
| `src/components/` | Shared widgets (chat, notebook editor + graph, markdown/math/diagram blocks). |
| `src/views/` | Top-level views (Home, the learner's landing screen; Dashboard, the new-course flow behind its "Start a new course" button; CourseView; Settings; full-screen quiz / promotion test). |
| `src/skills/` | Built-in tutor **skill** bundles (`*.md` with frontmatter) — loaded at runtime. |
| `public/library/` | The bundled, offline **Library** (curated K-12 reference cards + assets + `index.json`). |
| `src-tauri/` | Rust backend, SQLite migrations, capabilities, bundler + updater config. |
| `docs/` | This doc + README assets. |

## The core (`src/lib/`)

- **`curriculum.ts`** — the generation pipeline (entry point `runGenerationPipeline`). See below.
- **`llm.ts`** — the provider abstraction (Ollama / OpenAI / Anthropic): streaming chat, schema-enforced
  structured output (`callLLMStructured`), embeddings, model-tier detection, and a preflight probe.
- **`db.ts`** — SQLite CRUD for every table, plus the WAL switch, boot health check and backup.
  `db-resilience.ts` holds their pure logic.
- **`knowledge.ts` / `progress.ts`** — persistent per-course knowledge files and subtopic mastery tracking;
  both feed context back into the tutor.
- **`quiz.ts` / `quiz-grading.ts` / `quiz-review.ts`** — quiz & promotion-test generation (schema-enforced,
  topped up to a target count, with answer↔explanation self-consistency checks that also read clock
  times, money and fractions, read an equation option by its result and skip a method key ("Subtract 7 from
  both sides"), rejection of explanations that correct themselves and of repeated options,
  near-duplicate dedupe, letter references in explanations renamed after the option shuffle, and an
  independent verify pass on capable tiers) and the end-of-test batched grader (deterministic match first,
  one call on a local model for the rest; see Content review › Grading and the study plan stay local).
  The `-grading` / `-review` helpers are pure and unit-tested. A multiple-choice key is set to the option
  it names as that option is written (`quiz-grading.ts alignKeyToOption`: a letter key, a key without the
  option's label, or one in other letter case, "mitochondria" for "B) Mitochondria"; a key whose own
  text starts like a label, "C. S. Lewis", is tried as written too), because the quiz marks the picked
  option right only when it is the key string; a key no single option matches is rejected. The study
  quiz's review pool (`db.ts getReviewPoolQuestions`, about a fifth of a quiz) is the course's missed
  questions, newest first; a miss leaves it once the same question (trimmed, any ASCII letter case) is
  answered right after it in that course, by the key, the model or the learner's own mark, and a later
  miss puts it back. In Review, a flashcard graded Again is due at once and comes back at the end of the
  same session (`srs.ts requeueIfDue`), and when a grade or a delete empties the queue the due cards are
  read again, so "Nothing is due right now" shows only when nothing is.
- **`content-review.ts`** — the content review of generated lessons and questions. See below.
- **`notebook.ts` / `notebook-links.ts`** — the notebook layer (retrieval + linking). See below.
- **`kernel/`, `tools/`, `skills/`, `permissions/`** — the tutoring runtime. See below.
- **`daily-goal.ts`** — Home's daily goal: minutes a day and today's count, on the learner's local day.
  App adds one minute per minute the window is visible with a learner in, on the learner's own screens
  (`countsTowardGoal`): a minute in Settings is a grown-up's and never counts (click test 2026-11-14).
  The learner picker and its PIN screen never count either: no timer runs without an active learner.
- **`ai-notice.ts` / `break-reminder.ts`** — the AI disclosure and the break reminder, and what the
  grown-up and the learner are told about whether a lesson was checked. See "AI disclosure and the break
  reminder" and "Whether a lesson was checked" below.
- **`store.ts` / `store-keys.ts` / `models.ts` / `theme.ts` / `settings-schema.ts`** — settings, the model
  catalog, the Light / Dark / Match my computer switch, and pure import/export helpers. `store-keys.ts` is the single source of
  truth for setting keys + the secret/import allow-list.
  The generation and chat models are stored **per provider** (`modelStoreKey`: `gen_model_ollama`,
  `chat_model_anthropic`, …), so a pick made on one provider never overwrites another's, and switching
  back finds that provider's own pick (with none, its default). Versions before that kept one
  `gen_model` and one `chat_model` for all three providers. The first model read or write moves each
  such value to the provider it belongs to and deletes the old key (`store.ts` `migrateLegacyModelKeys`,
  `store-keys.ts` `legacyModelKeyMoves`); a settings file that still has them imports the same way
  (`importableSettings`). A value goes to OpenAI or Anthropic only when it is exactly an id OpenEdu
  offered there (catalog, `CLOUD_SHUTDOWNS`, `FORMER_CLOUD_MODELS`; `models.ts` `legacyModelOwner`),
  otherwise to Ollama: a local model imported from a folder can be named `gpt-2` or
  `claude-3.7-…-gemma3`, and no name rule tells it from a cloud id. The only name rule left is the last
  guard, `isOllamaTag`: a `name:tag` is never sent to a cloud API.

The pure, Tauri-free modules (`store-keys`, `models`, `version`, `text-match`, `settings-schema`,
`theme` helpers, `permissions/presets`, `notebook-links`, `quiz-grading`, `quiz-review`, `mastery`, …) are
unit-tested with Vitest.

## The generation pipeline (`curriculum.ts`)

Every course has **6 levels**: L1–L5 are LLM-generated syllabuses (3–6 subtopics each); **L6 is a mastery
exam assembled directly from the outline with zero LLM calls**. The pipeline is
**research → outline → tutor instructions → six syllabuses**, and the lessons that make it reliable on a
4B model are baked in:

1. **Decompose, don't dump.** Research is five small structured sub-calls, code-assembled into a brief —
   a single free-text dump was unreliable on small models.
2. **Schema-enforced everywhere.** Provider-native enforcement + a local validator + repair-retry.
   On Anthropic that is structured outputs (`output_config.format`, `callAnthropicStructured`), not a
   forced tool: Claude Sonnet 5.5, Opus 5.5 and Fable 5.2 answer a forced `tool_choice` with a 400, and
   all four current models accept structured outputs (TerraTutor B10 round 2's probe; real calls on
   2026-11-14 through preflight, research, outline, syllabus, lesson, quiz and review all returned 200 on
   that path). The API rejects some JSON Schema keywords there, so `anthropicOutputSchema` sends a copy
   without `minLength`/`maxLength`, numeric bounds, `maxItems` and `minItems` above 1, with
   `additionalProperties: false` on every object and each dropped bound written into the field's
   description ("at most 400 characters"). The reply is still validated against the full schema, so the
   trim and the repair prompt below work as before. A 400 about the output format (a model or schema the
   API cannot do it for) retries that call once as a forced tool, the path older models take.
   Every parsed reply gets LaTeX commands back that a JSON escape turned into a control character
   (`\text` written with one backslash parses as a TAB + "ext"; `repairLatexInValue` in `json-lenient.ts`).
   A lesson section that stops mid-sentence is a validation issue (`lessonIssues` in `lesson-format.ts`).
   **A string past its `maxLength` is shortened, not failed**, when that is the only schema issue
   (`trimOverlongStrings` / `trimToLimit` in `llm.ts`): cut at the last sentence end that fits, or at the
   last whole word plus "…" when no sentence of the field's `minLength` fits, never inside a word; the
   result must pass the schema and the caller's `validate`, else the repair prompt runs as before, and
   each trim is logged with its path and lengths. Quiz and test questions opt out (`trimOverlong: false`):
   a word problem cut at a sentence end can lose the sentence that asks it, so they are repaired instead. Ollama and Anthropic do not enforce `maxLength` while
   the model writes: Ollama's grammar leaves it out, Anthropic's structured outputs reject it (it goes as
   words in the description), and the forced `tool_use` used before got it in `input_schema` but did not
   hold to it (probe 2026-11-14: `claude-haiku-5-5` wrote 156-195 characters into a 120-character field,
   3 of 3). In B10, 19 of 20 Haiku course builds failed on 1-20% overruns (`what_it_is` 407-447 of 400,
   `level_description` 412-479, `domains[].focus` 201-228 of 200, `objective` 242-253 of 240) that two
   repairs never fixed. The caps stay as they are: the overruns were small, and a whole first sentence
   is still a full definition.
3. **Auto-detected model tier** (`tiny | small | medium | large`) drives prompt compression, schema
   relaxation, few-shot injection, and per-call timeouts. Matformer models (`gemma3n:e4b` / `gemma4:e4b`)
   get a name-based tier override so they don't mis-tier.
4. **Preflight before pipeline.** A one-shot probe fails fast on incompatible models.
5. **Checkpoint + resume.** `courses.generation_state` is written after each step; a failed run resumes
   from where it stopped (never delete the row on error).
6. **Code-assemble what doesn't need an LLM** (e.g. the L6 exam) for perfect reliability.
7. **A finished build opens its course only from the build screen** (`course-ready.ts`, App.tsx
   `onCourseCreated`). The build keeps running while the learner goes elsewhere; anywhere else they get
   a notice above the view ("Your course … is ready.", Open, ✕) and stay where they are, so a build never
   closes Settings or a dialog open in it. The notice goes once its course is open, by any route (Open,
   the course list, Home's Continue, or a build that finished while that course was on screen):
   `readyNoticeAfter` runs on every change of view, open course or notice.

### Content review (`content-review.ts`)

An optional check of **generated** content before a learner sees it. A small model writes lessons with
false facts (B9 rerun 2 on `gemma4:e2b`: at least 5 of 20 lessons, e.g. hydrogen and oxygen "produce
water and carbon dioxide") and promotion-test questions with wrong or unanswerable keys (about 10–17%).

- **One structured call** (`callLLMStructured`, schema-validated, tier-aware) per lesson, and per batch
  of fresh questions (8 a call on tiny/small, 20 otherwise). Each item gets a verdict: `ok`,
  `false_fact` (with the sentence), `wrong_key` or `unanswerable`, a short reason, and then a required
  boolean `statement_is_false` (after the reason, so the model commits once it has written why).
- **Code acts on the verdicts.** A lesson with a false fact is regenerated once, with the flagged
  sentences named as false in the prompt, and reviewed again. Parts still flagged are dropped; a lesson
  with no section left is not saved (the learner sees an error and can retry). Flagged questions are
  dropped and quiz.ts's top-up rounds refill them; the floor counts are unchanged. With a review model
  set, the review replaces the verify pass on fresh questions (it checks the key too).
- **Noise guard.** A `false_fact` counts only when `statement_is_false` is `true` and its quoted
  sentence is in the item (`quoteFound`). Code reads the boolean, never the reason's words: in B10, 4 of
  `claude-haiku-5-5`'s 5 lesson false alarms were `false_fact` verdicts whose reason said the statement
  was true, each costing a regeneration.
  Missing or unknown verdicts count as `ok`, and a failed review call keeps the content, so a confused
  reviewer can only let content through, never drain it.
- **The review's words never reach the learner.** They go to the log and into the lesson's one
  regeneration prompt.
- **Which model:** the `review_model` setting (`store.ts` `getReviewConfig` → `resolveReviewConfig`).
  Unset = the generation model, except that **lessons are not reviewed on the tiny or small tier**; `"off"` = no
  review; `"<provider>:<model>"` = that model on another provider (`parseReviewModel`), with the key
  saved for it, e.g. `anthropic:claude-haiku-5-5` so a local model writes and a cloud model checks, or
  `ollama:qwen3.5:9b` for the reverse. Settings always saves that form. A bare value (an older version's,
  or hand-edited; an Ollama tag such as `gemma4:e2b` is not a prefix) belongs to the provider
  `legacyModelOwner` gives it and is used only when that is the course model's provider; an Ollama tag
  named for a cloud provider (`anthropic:gemma4:e2b`) is ignored. A cloud reviewer is ignored, and the default applies, when
  its privacy confirm was never accepted here (`needsCloudNotice` for OpenAI/Anthropic,
  `modelNeedsCloudNotice` for an Ollama cloud model) or no key is saved for it.
- **The Checking model setting** (Settings › Models, `ReviewModelPicker.tsx`) writes `review_model`:
  Same as the course model (unset), Off, an installed Ollama model, or a generation-catalog model of each
  cloud provider with a key saved here, all stored as `"<provider>:<model>"` (`reviewModelChoices`). A
  cloud choice is saved only after that company's one-time notice (`reviewChoiceNotice`, the same
  `CloudNoticePanel` as the provider buttons; `privacy-screens.test.ts` holds the gate). `review_model`
  is importable like the other model settings; an imported cloud value does nothing until this PC's own
  notice was accepted (`cloud_notices_seen` is not importable) and a key is saved.
- **Measured on `gemma4:e2b` as its own reviewer** (B9 rerun 2's saved output replayed, 2026-11-14, one
  pass, prompt written before the replay, labels from the run's audit and Claude's reading of one test):
  lessons, 0 of the 5 known false lessons caught and 5 true statements flagged in 4 other lessons, so
  the lesson review is off on tiny. It is off on small too (`gemma4:e4b`, the 16 GB default): never
  measured as a lesson reviewer, and a false flag costs a regeneration plus a second review. Questions, 17 of 118 flagged and 14 of those truly bad: 12 of 12
  flags right on one promotion test of 38 with about 19 bad (money and clock arithmetic), but only 1 of
  the 5 confirmed wrong keys in the 80-question blind key-check sample, with 3 false flags. A small
  model's review catches checkable arithmetic, not facts; the lesson review needs a bigger or cloud model.
- **Privacy.** The payload is a function of (topic, generated content) only: no learner name, grade,
  answers, knowledge files or history. Lesson generation takes (topic, level, subtopic) and fresh
  question generation takes the syllabus, so their output carries no learner data. The quiz's review
  pool (questions this learner missed) is learner data, so it never goes to the review model, and its
  verify pass runs **only on a local model** (`privacy.ts` `isLocalModel`): the generation model when it
  is local, else this machine's default Ollama model if it is pulled (`store.ts`
  `getLocalVerifyConfig`), else the pass is skipped and the pool keeps only the validator re-check. Before
  2026-11-14 that pass ran on the generation model, so a cloud generation model received the missed
  questions (B10 audit). `content-review-privacy.test.ts` runs the generators for a fresh learner and for
  one with a full history and fails if the review payloads differ, if any cloud-bound payload of a cloud
  generation run holds the missed questions, or if a cross-provider cloud reviewer gets anything but
  the review builder's (topic, title, generated content).
- **Grading and the study plan stay local too.** Free-text answers (the learner's own words,
  `quiz.ts` `gradeAnswersBatch`) and the missed questions behind the study plan after a failed test
  (`generateStudyPlan`) go only to the model `getLocalVerifyConfig` returns. With no local model, answers
  code cannot settle (`gradeFreeTextDeterministic`) are passed leniently and stored as `graded_by
  'fallback'`, as when the grader fails, and the study plan is the one code writes from the missed
  questions. Both functions refuse a cloud config themselves, so a screen that passed the generation
  config by mistake still sends nothing; the same privacy test fails if any cloud-bound payload holds an
  answer or a missed question. Before 2026-11-14 both ran on the generation model. This is what lets an edition send generation
  and the review to a cloud model without sending anything about the learner.
- **One verdict per written answer.** The grading schema (`quiz-grading.ts` `batchGradeSchema`) names a
  required key per answer (`answer_1`…`answer_N`, `feedback` before `correct`), so Ollama's grammar
  cannot end the reply early. With a list of any length, `gemma4:e2b` (the default below 14 GB) closed it
  after the first answer in most batches and the rest were passed as `fallback` (TerraTutor's B10 round
  3: 8 of 20 marked). The prompt compares the student's words with the key; it no longer asks for
  generous partial credit, under which e2b and e4b marked typed nonsense right. The results screens
  show a `fallback` answer as not checked (`answerMark`, `UNCHECKED_NOTE`, `uncheckedSummary`), never
  with a right answer's tick; it still counts as right.
- **A safety disclosure typed outside the chat is not marked** (ported from TerraTutor #175). The chat's
  own check (`child-safety.ts isSafetyDisclosure` with the learner's grade, nothing wider) reads what the
  learner types into a quiz or level-test written answer, the study quiz's "In your own words, why is that
  the answer?" (once it is saved, on blur) and the new-course topic, and a hit shows `SAFETY_NOTICE` with a
  read-aloud button (`components/SafetyNotice.tsx`). On a question the notice shows as soon as the answer
  is recorded (`QuestionRenderer`, `quiz-grading.ts showsSafetyNotice`), and again on its results row in
  place of the answer, the key and the not-checked note (`showsAnswerAndKey` is false for it). The answer
  is not marked: `gradeAnswersBatch` never settles it by code or sends it to a model, and passes it as
  not checked (`graded_by 'fallback'`), so it is never a wrong mark and the answer stays in the attempt. On
  a level test it can make the test wait for the learner's own mark like any unchecked answer; the marking
  list shows the notice above it. On the new-course topic, the first Create shows the notice and builds and
  sends nothing; Create again with the same topic builds as usual, so a false hit ("suicide prevention")
  costs one click, never a block. With no grade set a pregnancy message is none of these, as in the chat.
  `safety-written-answers.test.ts` pins it.
- **A level test does not count an unchecked answer.** On a quiz a `fallback` answer still counts as
  right. On a level test it does not count toward passing until someone marks it (`level-test.ts`
  `levelTestResult`): the stored score leaves it out, and the result waits only when the unchecked
  answers could still pass or fail the test (it passes even if every one is wrong, or fails even if
  every one is right, and then nothing waits). A waiting test has `passed` NULL and at least one
  `fallback` row; each answer stores its part, `current` or `review`, in `quiz_questions.test_section`
  (migration 20), because the review section has its own bar. OpenEdu has one learner and no grown-up,
  so the learner marks them: the results screen (and the level test, opened again later) shows each
  one with the answer key and Right / Not yet (`components/quiz/CheckAnswers.tsx`). The marks are stored
  as `graded_by` `'self'` and the test is decided by `level-test-checks.ts` `settleLevelTest`, which
  moves the course up after a pass. A waiting test blocks a new attempt at that level, and a test not
  passed (`passed` 0) now starts the 24-hour wait even when only the review section fell short. The
  wait is counted from `completed_at` read as UTC (`level-test.ts` `retakeWaitLeft`); read as local
  time it ran 24 hours plus the UTC offset.
- **A level test that came out short is not given.** `quiz.ts` `levelTestShortfall` refuses a
  generated test under `TEST_FLOOR` (30) questions, or one whose review section came back empty
  although the course has earlier levels (`reviewWanted`): no attempt is created, so the test is not
  taken and cannot promote, and the intro says why and to try again. The pass rule counts an empty
  review section as passed, which is right only on a level 1 test. A test between the floor and 45
  questions is given with a note.
- **A learner can always leave a quiz or a level test.** On Ollama the questions are written one model
  call each (20 for a quiz, 45 for a test, plus top-ups), which on a computer with no graphics card is
  slow. Both "making" screens have "Stop and go back": it aborts the `AbortSignal` the screen passes to
  `generateQuizQuestions` / `generatePromotionTestQuestions`, which reaches every `callLLMStructured`
  (the model load too), the verify pass and the content review; `quiz.ts` `stopIfAborted` then rejects
  instead of returning a short set, so no attempt is created and nothing is taken or counted
  (`quiz-stop.test.ts`). The level test's ready screen says that making it can take a long time and can
  be stopped (`level-test.ts` `testMakingNote`; no timing is given because none was measured on such a
  computer). A begun level test has "Stop the test", which asks once (`STOP_TEST`, `stopTestBody`) and
  leaves the attempt unfinished: never scored, the level unchanged, no retake wait
  (`getLastPromotionAttempt` reads finished tests only). The answers already given stay saved, so a
  missed one can come back in a quiz (`getReviewPoolQuestions`), and the confirm says so when there is
  one (`db-level-test-stop.test.ts`). Closing the window does the same; the Titlebar stays over both
  screens so it can be closed. "Checking eligibility" has a Back button and says when the check failed.
- **Ollama stopped is not a weak model.** A question call or verify pass that fails because Ollama can't
  be reached, or doesn't have the model (`plain-language.ts` `ollamaUnavailable`, matching the sentences
  `llm.ts` writes), stops making the quiz or test at that call instead of skipping the question. No
  attempt is created (so no short review-only quiz starts from the missed-question pool), and the screen
  shows `friendlyError`'s Ollama sentence, never "pick a more capable model". The course build does the
  same for a subtopic expansion: the level fails unsaved, so resuming rebuilds it, instead of saving a
  placeholder subtopic. A chat reply whose stream breaks after text reached the learner ends as
  `stalled` and is saved with its marker; with no text yet, the error names Ollama. A failed
  `getOllamaVersion` probe is not cached, so structured calls get the schema format again once Ollama is
  back (`ollama-down.test.ts`).
- **Code settles an answer that is the key in another form.** Before the batch goes to the model,
  `answer-match.ts` `settleByCode` puts the answer and the key in one form (case, punctuation, a leading
  "it's" or article, number words as digits, plurals) and accepts the answer when it is the key or one
  of the key's accepted forms: a part of the key in brackets or after a slash, the key's number with
  none, some or all of its own units ("a hundred degrees" for "100 degrees Celsius", never an added
  unit, units in the key's order, so "60 hours per km" is not "60 km per hour"; the degree sign reads
  as "degrees", so "100 degrees C" is "100 °C"), an ordinal in words or digits with the key's other
  words ("the fourth planet" for "4th planet"; never "4" for "4th", and "the fourth" alone goes to the
  model), a spelled formula ("h two o"), a person's surname when the question asks who or names a
  person's role ("Which scientist", "Name the author") and the key is a name: its last word, or for a
  name of 3-4 words its last two ("conan doyle", never "w bush" for George H. W. Bush), never under a
  choice, for a role the question does not ask for ("Which country's president"), for a key that names a
  place or a thing ("South Africa", "Soviet Union": a direction, "New" or "Holy" first, or an adjective
  in the dictionary before an everyday word), or when the question itself says
  the surname ("Which Roosevelt...?", "Lincoln's wife"), also after a title in place of the first name
  ("madame curie", "dr king", "lord byron"), under the same guards. "Dr" says nothing of the person; a
  title that says man or woman ("mrs", "lord") counts only when the question says the same and never the
  other ("the first woman", "his"), so "mrs roosevelt" for Franklin or "mr curie" for Marie goes to the
  model. An amount with its
  sign written as a word: a depth or height ("11 meters below the surface", "11 m down" for -11 m, only with a unit of length), a balance ("$15 overdrawn", "owes $15", "$15
  in debt"), a temperature ("15 below zero"), a score ("15
  points behind", "3 under par" on a question that says par), and, only on a question whose last
  sentence asks for a change, a profit, a gain or a loss, a change ("a loss of $12", "a drop of 8
  degrees", "down 12"); a change form is never a balance or a temperature,
  nor the other way round. Only the key's amount and the sign the word means ("$15 in credit" for -$15,
  a bare "$15" or "fifteen" go to the model; a direction word is a sign nowhere else), never on a
  question that asks for the sign (an integer, a signed or negative number, "represent", "express") or
  already says the amount and a word of the same direction ("A diver is 11 m below the surface"). Only a key written negative carries a direction code can match: a
  positive key is how an unsigned size is written ("15" for a score that went from 40 to 25), so a rise, a
  credit, "above" or "ahead" for a positive key always goes to the model. A minus before a dollar sign is a sign ("-$15" is
  -15), so "$15" is no longer taken for -$15 (nor "-$5" for $5). A year said in pairs ("twelve
  fifteen" for 1215, "nineteen sixty-nine", "eighteen oh five", "twenty oh one", "two thousand and
  one") for a key of 1000-2099 in digits, only on a question that asks "what year", "which year" or
  "when did/was", never one about a count or a size ("How many books", "number of"), a clock time, a
  choice of years ("1215 or 1512?"), one that says the key, or one that asks for a form;
  and a one-edit misspelling of a key word of 6 letters or more when the answer's word is not
  itself a word in the bundled dictionary ("neuron" for "neutron" goes to the model), nor the key's
  word with a negating prefix added or taken off ("abiotic" for Biotic), a contrasting affix swapped,
  or a function word WordNet lacks ("toward" for Coward): the misspelling note's guards (#328). Never two edits
  ("omnivour" goes to the model: "glucogan" is as close to glycogen as to glucagon). No
  misspelling counts when another dictionary word is one edit from the answer's word ("slovania"),
  when a word the question offers is as close, or when the key word is not in the dictionary (it has
  no names of places or people, so "Zambia" for "Gambia" goes to the model). A name has its own rule:
  a capitalised key word in neither the dictionary nor the English word list (Sahara, Pompeii) takes an
  answer word in neither that keeps its first and last letters and is one slip of spelling by ear away,
  two for a name of 7+ letters (a vowel for a vowel, a vowel added or dropped, a letter doubled or
  undoubled, two neighbours swapped: "sahera", "pompei"), unless a word of the question or key, a
  country, a US state, a continent or a planet is as close ("slovania" may be Slovakia; "Zambia",
  "niger" for Nigeria and "george" for Georgia go to the model). A clock time in words settles for a
  clock-time key ("quarter after eleven" for 11:15, "noon" for 12:00 p.m.); a.m./p.m., "in the
  morning" and the like only when they are the key's half of the day, and no half only when the key
  has none or the question pins it ("half past three" for 3:30 p.m. after "leaves at 3:10 p.m.", and
  "3:30" too). A half the answer gives and the key does not goes to the model ("1:30 a.m." for 1:30 on
  an elapsed time that crosses noon), and so does, on a conversion, a time without its half, in words, or
  in another form than the key's ("4:15", "quarter past four" or "4:15 p.m." for 16:15): a conversion
  is a question that says anything about the answer's form (any hour-clock wording such as "24-hr" or "24h", military,
  railway, standard or digital time, "a.m. or p.m.", digits, words, or write / convert / express) or gives
  the key's time of day written another way ("Write 16:15 ..." for 4:15 p.m.). A time in words is never
  marked wrong. A sign's name settles
  when the key is the sign itself ("greater than" for ">"; never "greater than or equal to" or "less
  than"), never the sign for a key that is a name, and only to fill a blank between two numbers
  ("7 __ 2") on a question that neither shows the sign nor says a word of its names or what it does
  ("Which symbol means greater?" goes to the model). A key of 1-3 letters may be written spaced
  or dotted ("n a" for "Na"), but letters cased as another element symbol never settle ("CO" for
  "Co"), and on a question about symbols or formulas such a key needs its own case. It never accepts
  on a shared word ("red" for "red blood cells"), and it compares words in order, so the key's words
  reversed ("4 girls per boy" for "4 boys per girl") are not the key. A number never settles past the
  key's other words when they say something the answer contradicts or leaves out: another noun ("6
  arms" for "6 legs"), am/pm, a sign, direction or fraction ("4" for "Negative 4", "2" for "Two
  thirds"), another unit or an ordinal ("1st" for "1 second"), or any word that is not a unit ("4" for
  "4 light years", "2" for "2 dozen eggs" go to the model). The only word a number may gain or lose is
  the thing a "how many" question counts ("12 pencils" for "12", "6" for "6 legs"; not "12 packs").
  When the question offers a choice ("Is noon 12 AM or 12 PM?", "10 cm vs 10 m?") or already says the
  number, the answer must give the key's whole answer. These rules never mark an answer wrong; what code
  cannot settle goes to the model as before, and what it settles is stored as `graded_by` `'exact'`. A
  formula's count is no longer read as a number ("CO2" had passed for "H2O" as the number 2).
- **Code decides a number and unit both ways, when it is sure.** When the key and the answer are each one
  quantity and nothing else (`answer-match.ts` `settleQuantity`: digits, commas, a leading dot,
  fractions and mixed numbers, scientific or e notation, "150 million", number words, a sign or "below
  zero", and one unit from a small table: length, mass, volume, time, square and cubic, one unit per
  another such as km/h or g/cm³, percent, money, temperature on one scale, or a clock time), code
  converts units and compares amounts. The same amount is right ("1 g/mL" for 1 g/cm³, "8 mL" for 8
  cm³, "16:15" for 4:15 p.m., "45%" for 9/20 when the question asks for no form; on an estimate question,
  within 10%: "1,050" on "Estimate 49 x 21"). Code marks an answer wrong only on a gross miss: another
  kind of unit ("8 cm²" for 8 cm³), a factor of about 10, 100 or 1000 ("4.5%" for 45%, "0.33 g/cm³" for
  3 g/cm³, "-15 km" when the question asks for meters; not "45" for 0.45, the same number read as a
  percent), a.m. for p.m., the other sign only when the question is nothing but an expression ("2" for
  "What is 3 - 5?"; in a word problem either sign may be meant, so the model decides), or, when the question gives the numbers and
  asks for no estimate, a different fraction for a fraction key that does not say about ("2/8" for 1/2)
  or more than 20% apart ("75 cents" for $1.75). A bare number for a percent key is read as a part when
  that is nearer ("3/4" for 70% is 75%). Such a mark is
  stored as `graded_by` `'exact'`, wrong, with the feedback "This does not match the answer key."
  Never on precision alone: a measured fact ("340 m/s" for 343 m/s, "8,848 m" for Everest, "3/4" for
  7/10 or 70% of Earth's surface), an
  estimate, pi or a rounded conversion factor goes to the model. Code also leaves to the model: an
  answer that says "about", has two numbers, a range, an expression or any word the table does not
  know; a one-letter unit of another kind ("9 m" for 9 m², which may mean minutes); another temperature
  scale, or a scale left out when the amount differs ("32 degrees" for 0 °C); years against days, and
  months against days or weeks even on an "about" key ("about 2 months" for about 61 days); a bare
  number that may be the key in some other unit ("1000" for 1 L, "0.45" for 45%) or on a question that
  asks for the unit; a bare count other than the key on a question that names what it counts ("How
  many fourths", "in thirds"; "3" for 3/4 there is right); the right value in another form than the
  question asks ("0.45" on "Write 9/20 as a percent", "75/100" for simplest form, "30 × 10^3" for
  scientific notation, "1500 m" on "in kilometers?"); the amount a conversion gives, given back in its
  own unit ("3 feet" on "Convert 3 feet to inches" or "3 feet = ___ inches", "250 cents" on "How many
  dollars is 250 cents?": `givesBackAmount`, only when the question also names the key's unit, so "1 hour"
  for 60 minutes on "How long is one hour?" stays right); a ratio; and any other clock time. Measured in
  `src/lib/eval/results/2026-11-16-grade-dev-numbers.md`. The table also reads decades, centuries,
  millennia, fortnights and months ("5 decades" for 50 years, "a fortnight" for 14 days, "1.5 years"
  for 18 months), but only to accept: an amount in one of these is never marked wrong ("4 decades" for
  50 years goes to the model), and a bare number is never read in one. Nor do they settle where the
  answer may be the question said back: a key that is the word ("A decade"), a question that names one
  of these units ("How long is a decade?") or says the answer's amount ("What is a period of ten years
  called?"). Measured in `src/lib/eval/results/2026-11-16-grade-dev-restate.md`.
- **A note to the model on a misspelling code cannot accept.** An answer that is the key with a word
  one edit (key word 4+ letters) or two edits (7+) off ("skelitin" for skeleton) goes to the model with
  a note under it: `"skelitin" may be a misspelling of "skeleton". If it is, mark it correct: for this
  answer, spelling is not marked.` (`answer-match.ts` `misspellingNote`, `quiz.ts` `misspellingNotes`).
  The model still decides. No note when the answer's word is the key's word with letters added at the
  front, which may mean the opposite ("unextinct", "intransparent"; `prefixAdded`, which also takes a
  negating prefix on the key's word one edit off, "atipical", and the key's word with a negating prefix
  taken off, "matchable" for Unmatchable), when the answer swaps a contrasting prefix or suffix of the
  key's word (hyper/hypo, inter/intra/extra, mega/giga, bi/tri/penta/hepta, -philic/-phobic,
  -philia/-phobia, -itis/-osis, -ectomy/-otomy, -tion/-tor and others;
  `affixSwapped`: "hypoventilation", "lipophobic"), when the key writes the word in capitals (an acronym
  or symbol: "NADPH" for NADP), when it is a function word WordNet lacks, a contraction typed without its
  apostrophe included, or one is as close ("until" for Untie, "their" for Heir, "theyre" for there), when
  a word of the question is as close ("farther or further?"),
  when the answer's word is a real word, in WordNet or in the bundled English word list (unless it is
  the key's word with one British/American spelling swap, our/or, ise/ize, re/er, ae/oe/e, ph/f, ll/l, ium/um, and the dictionary lists the two
  as synonyms: "aluminium"; WordNet's synonyms alone also hold other forms, bacterium for bacteria,
  earlier for earliest), when the key's word is not in the dictionary, or when another real word is as
  close ("glucogan": glycogen; "orbet": sorbet), counting another word's -ing, -ed or -s form the
  dictionary resolves ("attatching" for Attacking: attaching; "enhaled" for Exhaled: inhaled). The check
  reads every one-word dictionary headword once per session (`dictionary.ts` `oneWordHeadwords`), only
  when an answer needs it, and makes the forms from them with WordNet's suffix rules
  (`answer-match.ts` `formsWithin`). WordNet lacks many real words ("chalcogens" for Halogens,
  "granivore" for Carnivore, "voltammeter" for Voltmeter), so the answer's word is also looked up in
  `public/wordlist/` (`wordlist.ts` `inWordList`: one shard by two-letter prefix, fetched when asked
  for), which `scripts/build-wordlist.mjs` builds from the word-list npm package (MIT, 274,137 words,
  version and sha256 pinned in `meta.json`, licence in `LICENSE` beside it). If the dictionary or the
  word list cannot be read, no note. A batch with no note
  gets the old prompt byte for byte; in a batch with a note, each answer is kept to one line and an
  answer that opens with "Note:" has its colon replaced, so no typed answer passes for a note. Measured in
  `src/lib/eval/results/2026-11-16-grade-dev-misspelling-hint.md`.
- **"I think I was right."** A small model still fails some right answers, so on the quiz and level
  test results screens a written answer the model or code marked wrong (`graded_by` `'model'` or
  `'exact'`, wrong) has the
  button "I think I was right" (`components/quiz/MarkAgain.tsx`). The learner compares it with the key
  and marks it Right or Not yet, stored as `'self'`. `written-answer-checks.ts` `markAgain` counts the
  quiz's score again, or decides the level test again the way `settleLevelTest` does: a failed test
  the mark passes is passed and the course moves up; one that now depends on answers no model checked
  goes back to waiting for them (`reopenLevelTest`); one whose result cannot change stays decided with
  its score counted again. Only a model's or code's wrong mark can be marked again, never the key's, a
  right exact match or a hand mark.
- **A mark made after the finish redoes what the finish saved.** The finish saves skill mastery, the
  course's progress and the tutor's progress context, a level test's flashcards from its misses, and the
  study log line with its "Needs review" note (`finish-effects.ts` `saveFinishEffects`, run by both
  screens). `markAgain` and `settleLevelTest` then run `recountAfterMarks`, which redoes each from the
  stored answers through the same functions: a skill whose right answers changed gets this attempt's new
  score and then every later attempt's at that level, in finishing order (`updateSubtopicMastery`);
  progress and the context are worked out again; a question marked right loses the card made from
  missing it unless another attempt still has it wrong (cards the learner made are never touched), and
  one marked wrong gets its card; the study log line (found by its date, "Quiz" or "Level test", and old
  score; a level test's line written before it had its own name still says "Quiz" and keeps it) and the
  note are written again. What it does not redo: mastery is never taken away (a lower score flags the skill for
  review instead, the app's own rule); answers with no skill id; a line no longer in the log. A failed
  test's study plan joins its log line when the model finishes it (`addStudyPlanToLog`), only while the
  line is as the finish wrote it, and a rewrite drops a plan when the wrong answers changed, since it was
  written for them. No model is asked again. The results screens make a mark wait for the finish's saves.

## The tutoring runtime (`kernel/`, `tools/`, `skills/`, `permissions/`)

A tutoring turn is owned by the **kernel** (`TutorEngine`): it assembles a layered system prompt, runs the
model, dispatches **tools**, and applies **stop hooks** to decide when the turn ends. Capabilities the
tutor can invoke are **EduTools** (zod-schema'd, modeled on Claude Code's tool shape) — e.g. notebook
search/ingest, math/diagram render, knowledge-map updates, mastery marking, and a mid-turn "ask the user"
tool. Behavior is composed from **skills** (`src/skills/*.md`; user-sideloaded bundles are not implemented yet):
markdown files with frontmatter that gate on subject/tier. A per-tool **permission** policy
(allow / ask / deny, with Standard · Cautious · Trusting presets) governs what the tutor may do on its
own.

A course's **domain skill** (`math-tutor`, `science-tutor`, `code-tutor`, `music-tutor`) is chosen in code
on every turn (`skills/trigger.ts`, `kernel/chatSkills.ts`), with no model call. It decides which drawing
tools the tutor is offered: `diagram.render` comes only from a domain skill, and `math.render` only from
`math-tutor`. Each domain skill lists subject words in `trigger.course_subject`, matched on word boundaries
(a plural `s`/`es` counts). The course's topic decides first: the first domain skill with a word in it
wins. A topic with no subject word falls back to the course's stored syllabus: the skill whose words
appear in more than half of the subtopics (title plus key concepts), and in at least two, wins. One
"Rhythm and Meter" subtopic in a Poetry course does not make it a music course. Phrases in
`trigger.course_subject_exclude` are taken out first ("political science" is not science). Because it
runs on the topic and syllabus every course already stores, courses made before a word was added route
by it too. Physics stays with `math-tutor`. Click test 2026-11-14: a course called only "Fractions" got
no domain skill, so the tutor was never offered `diagram.render` and could not draw. On a sweep of
K-12 titles (`skills/subjectSweep.ts`) the topic alone had missed 33 of 42 math titles, and no science
course had a domain skill. Now 0 of 42 math and 0 of 22 science titles miss. On 70 held-out titles,
written by an agent that never saw the word lists, 2 of 40 math and 4 of 30 science titles miss by topic
alone ("Number Bonds", "Phases of the Moon"…), and none of 40 other titles routes wrongly. A course with
such a title still routes by its syllabus. Known and accepted: "Shapes in Art" is offered the math tools.

When Ollama cannot parse a tool call the model wrote, it fails the whole request (HTTP 500, or an error
line in the stream). If nothing from that model call had reached the student yet, the kernel answers that turn with one call
that offers no tools and drops the tools manifest from the system prompt, and records it in the turn
result (`toolCallRecovery`). Any other provider error fails the turn as before.

Two write actions do not wait for the model to choose a tool, because small models rarely do (on
`gemma4:e2b`, `flashcard.create` 0/20 and `ask_user.question` 2/20 in TerraTutor's B9 readiness run):
- **A flashcard the student asks for** (`kernel/flashcardRequest.ts`). Code decides the message asks for
  one card (a request verb and a singular "flashcard" in one sentence, with no negation before the verb,
  no question opener such as what/how/"can you show", and no "for each"/"all of"). Unless the permission
  rules deny `flashcard.create` (then nothing runs), a "Making a flashcard…" chip shows and one
  structured, validated call writes the two sides from the request and the tutor's last message (no
  repair attempt, 45 s deadline). The card goes through `flashcard.create`'s own dispatch (permission
  rules, the confirm card, the "Card minted" chip), in any mode; the reply call gets a note saying it is
  saved and is not offered the tool again that turn. The call shows in `toolCalls` with `byApp: true`;
  the eval runners count only the model's calls (`kernel/modelToolCalls.ts`), and the tool goldens turn
  the stage off (`flashcardStage: "off"`). A failed or timed-out card call clears the chip and leaves the
  request as it was. Cost: on Ollama the card call is its own short prompt, not a continuation of the
  turn's prefix, so on a card turn the reply misses the prefix cache and re-prefills the system prompt
  and tools manifest once.
- **Choices written as a list** (`kernel/replyChoices.ts`). A completed reply that made no
  `ask_user.question` call and ends with a short numbered or lettered list next to a question that asks
  for one pick (which / choose / pick, and not order, two of, all, each, why, explain, notice, another)
  carries those choices in `replyChoices`. Labels with LaTeX, a blank (`__`) or a trailing `=` don't
  count; a lettered list needs its question before it. A bulleted list (-, *, + or •, one style) counts
  only when its question also asks what the student wants (would you like, do you want, should we…),
  since bullets are also how a tutor lists facts it then asks about. Emoji after the question mark
  ("Which one sounds best? 😊") don't stop a line counting as the question, here or in the chips'
  `endsWithQuestion` (`withoutTrailingEmoji`, click test 2026-11-14). Anything in doubt gets no buttons. The chat shows
  them as the ask_user buttons, with only the stuck chips and "Review due cards" beside them
  (`chipsBesideChoices`), and a pick is sent as the student's next message. The reply text is unchanged.
  The question is always a line of the reply, so the buttons show without it when the reply ends on it
  (`repeatsQuestion`, below).

**Question cards** (`kernel/askCard.ts`, `tools/ask_user/QuestionTool.ts`). Click test 2026-11-14 on
`gemma4:e4b` (fractions L1, "Check if I've got this."): the card asked "Think about the fraction 1/5.
Which number, 1 or 5, is the unit fraction part?" with the buttons "What is the denominator?" and "What
is the numerator?", the chat box was disabled, an empty "Thinking…" bubble sat above the card, and after
a pick the turn ended with only a "✓ Done" chip. The cause of that ending: the tool handed the model
`{"choice":"numerator"}`, and the model's next call came back empty (headless, same card, same model: 5
of 8 runs; 8 of 8 when retried without tools). The never-blank rule below only covered turns that ran no
tool, so the turn returned "", ChatTab saved nothing, and the question lived only in the card. Now:
- **Repair, by code, before the card is shown** (`repairAskCard`, fails closed). A question that names
  its own choices ("1 or 5", "1/2, 1/3, or 1/4", "bigger or smaller": numbers, fractions or single words
  joined by "or", one kind throughout, and "not", "yes", "do" and the like end the list) where no button
  mentions any of them gets the named choices as its buttons. Buttons that are all "What is X?" / "Is it
  X?" on a card that is not a topic picker become "X". Anything else is left exactly as written; the
  repaired card is what the claim filter, the child, the model's record and `toolCalls` see.
- **Never a dead end.** While a card waits, the chat box stays usable ("Or type your own answer…", plus
  a "Type my own answer" button that focuses it), and what the child sends answers the card. No
  "Thinking…" bubble shows above a card when nothing has streamed.
- **Unless what they type is a safety disclosure** (ported from TerraTutor #165). Typed words that
  `isSafetyDisclosure` matches, with the learner's grade (`TutorTurn.grade`, the same check as the notice
  under a chat message, nothing wider), are not the card's answer: the turn ends at the card, which keeps
  only its question in the reply (`askedCard`), and nothing is graded, echoed ("*You answered: …*") or sent
  to the model, and no fallback line follows, even when an earlier card this turn was answered and graded.
  The kernel hands the words back (`TutorTurnResult.cardMessage`) and ChatTab saves them as the child's own
  message straight after that turn's reply, before anything that can drop them (a switch to another
  conversation, or the chat closing for another tab, course or level, which loses its state), then runs the
  reply to them once the turn has finished (none if the child opened another conversation first; the words
  stay saved in their own thread), so they get what a typed chat message gets:
  `SAFETY_NOTICE` under it and `CHILD_SAFETY_RULES` in the system prompt. Before, they reached the model
  only as a tool result, with no notice.
- **The model is told the answer in a sentence** (`questionModelText`): `The student picked "1". Reply to
  the student now, following on from their answer.`, or `The student typed their own answer instead of
  picking a choice: "…"`. On the same card that took empty replies from 5 of 8 runs to 1 of 8.
- **The question and the answer stay in the thread.** Once answered, the card's question and
  "*You picked: …*" (or "*You answered: …*") join the reply's text (`answeredCard`), so they stream, are
  saved with the reply, and are in the model's history next turn. The "✓ Done" chip for the card is gone.
  When the text before the card already ends on its question (`repeatsQuestion`: the reply's last
  sentence, after any trailing choice list, is the question), the card shows only its buttons and the
  record only the answer, so the question is said once.
- **Always a reply after the answer.** A model call after the answer that shows nothing and calls
  nothing is made once more, as it was; a second empty one gets `AFTER_ANSWER_REPLY` ("Thanks! Tell me
  a little about why you chose that, and we'll keep going."). With both, 10 of 10 headless runs of the
  click-test card ended on a visible tutor reply.

A reply that says it shows a picture and shows none is corrected by code too (`kernel/pictureClaims.ts`;
click test 2026-11-14: "Here is a picture of a pizza cut into 4 equal slices." with nothing drawn). On
the finished reply of a turn that was not stopped or stalled, if nothing was drawn (no `diagram.render`
that ran, no Mermaid in the reply, no fenced block, inline SVG, markdown table, local image or row of
emoji), each sentence that says a picture, diagram, drawing or chart is shown ("Here is a picture of…",
"Look at the diagram below", "I've drawn…", "Let me draw it") is taken out, and the first one's place
takes "Want me to draw it?", unless the reply already offers to draw. What follows a colon in it stays.
Questions, offers, instructions to the student and conditions are not claims. The stream has already
shown the claim; the saved reply, which replaces it on screen when the turn ends, does not have it.

Mastery is not one of them: it is decided in code from quiz and promotion-test results
(`updateSubtopicMastery`, ≥ 90% per subtopic). `progress.mark_mastered` is a secondary path, and a
model's praise alone never marks anything.

### The answer check in assess mode (`kernel/answerCheck.ts`, `answerCompare.ts`, `replyClaims.ts`)

Assess mode (`src/skills/assess.md`, the "Check if I've got this" chip; under a reply that asks nothing
it leads the mode chips on a new level, where no subtopic is mastered yet, and once every subtopic is)
is a short mastery check: the
tutor asks one or two questions it writes itself, so nothing in the app holds their answers. On
TerraTutor's B9 rerun on `gemma4:e2b` the tutor told the child a wrong answer was correct in 11 of 20
turns ("7 x 9 is 72" → "That is correct."), and replies said "you have mastered" with nothing recorded.
So the verdict on the child's answer is the app's, not the reply's:

- **When.** The newest message is the student's answer (not a request, a question back or a meaning
  question; a request includes asking for a picture or a change of plan: "Draw me…", "Let me pick…",
  "Can we…", "I want…", "Teach me…", "Let's draw…") to the tutor's message just before it, in a
  mastery check: the turn runs in assess mode, or
  a request for one is among the student's last four messages: the assess chip's message
  (`ASSESS_MESSAGE`) or the same request typed (`asksForMasteryCheck`: "quiz me", "test me on
  fractions", "can you check if I've mastered fractions?", "am I ready for the test?", opening the
  message or a clause of it; not "check my spelling", "check if I got this right" or "my teacher will
  quiz me tomorrow"). The chat resets the mode after every send, so in the app the answers arrive in the
  default mode; the request in the history is what marks the check. A typed request runs in the
  default mode, not assess. Never when the newest message is a safety disclosure (`isSafetyDisclosure`
  with the learner's grade, `TutorTurn.grade`; ported from TerraTutor #165): "this is too hard i wanna die"
  or "my dad hits me when i get them wrong" is not a wrong answer, so that turn gets no answer check, no
  check-before-praise note, no verdict line ("That's not right yet.") and no check on a card answered
  during it, and a "mastered" mark on it is refused (`MASTERY_REFUSED_DISCLOSURE`). Nor a dictionary note
  or card (ported from TerraTutor #191): "I want to die. what does suicide mean?" was given the entry, its
  example and "explain it with one everyday example"; the turn takes the safety path only.
- **A pick on a question card is an answer too.** In the chat only assess mode offers
  `ask_user.question` (`src/skills/assess.md`), so every card a child answers there is in a mastery
  check, and a pick is the child's answer to the card's question. Until 2026-11-14 it reached the model
  as `The student picked "72"` with no verdict, so a wrong pick could be praised, called mastered and
  marked mastered, while the same answer typed could not. Now, on a turn of a mastery check (or any turn
  whose typed answer was checked), each answer to a card goes through the same check as a typed one,
  in the turn, before the reply after the pick is written. The key call reads the reply's text before
  the card, the card's question and its choices as the child saw them (`cardTutorMessage`); the answer
  is the label picked, or what the child typed instead (a typed request such as "I don't know" is not
  graded, `readsAsAnswer`). The verdict's note is appended to the tool result the model reads; the
  reply after the pick gets a claim filter of its own against that verdict (the verdict line, praise
  and mastery claims taken out, as below); a reply left empty ends on `VERDICT_FALLBACK`, not
  `AFTER_ANSWER_REPLY`; and a `mastered` mark is refused while any answer checked this turn, typed or
  picked, is not `correct` (`practiced` still runs, as for a typed answer). A card that asks nothing with
  one right answer (a topic picker) gets no verdict, and its turn is as before. `TutorTurnResult.cardChecks`
  lists the verdicts; `answerCheck` stays the typed answer's. Cost: the key call per answered card in a
  mastery check (none for a plain operation), and the grader when code cannot settle it.
- **The key, blind.** One structured call reads only the tutor's message and returns the question it
  asked (copied; validated against the message), one or two lines of working, and the answer. It never
  sees the student's answer: a 2B model judging an answer it has just read leans toward agreeing, and
  working the question out cold does not. Working that states a false sum ("6 x 8 = 46",
  `arithmetic-claims.ts`) fails validation and is repaired once. A message whose one question asks for
  one plain operation ("What is 6 x 8?", not "What is 5 + 3 and then double it?") is keyed by code
  with no call, and a model key for one ("Calculate 6 x 8.") is replaced by code's when they disagree.
  Two questions in one message are keyed together by the model ("63; 72"). A message that asks nothing
  with one right answer ("which topic next?") gets no check, and the turn is as before.
- **Code compares** (`compareToKey`). The same words once cue phrases are off, the same number in any
  plain form ("48", "forty-eight", "it's 48", "negative 5", "48 cm", "6 x 8 = 48") and no other number
  of the student's own, the same lettered option or yes/no: **correct**, with no further call. A
  plain-number key that none of the student's own numbers equals (numbers the question holds don't
  count): **mismatch**. Fractions, percents, times, money, "half", ranges, place value ("5 tens"),
  another unit, a rounding, a "not", algebra ("2x"), a key that is a comparison ("more than 5"), the
  key's number among others ("63 or 72"), or other words: **undecided**. Code never calls an answer
  wrong, or right, on a form it could misread: a false "wrong" is as bad as false praise.
- **The grader**, only when code did not find a match: one structured call reads the question, the
  key and the answer and returns the student's final answer in their words and `correct` / `partly` /
  `incorrect`. Code compares that copy with the key too. Where code and the grader disagree (code says
  the number is wrong and the grader says correct, or the reverse) the verdict is **unsure**. A failed
  or timed-out call (60 s each) is also unsure, never praise.
- **The reply is told the verdict as a fact**, in a `<tutor_note>` after the student's text (the same
  place as the other notes; it replaces the check-before-praise note on that turn; not saved), with the
  question the answer was to ("The question was: …"), so a reply after two questions does not answer
  the first when the child answered the second. The system prompt is untouched.
- **A filter holds each sentence of the reply** on a turn of a mastery check (the chip's own turn and
  the answers after it) until it ends (`ReplyClaimFilter`); other turns stream as before. Against an
  `incorrect` verdict, praise for the answer ("That is correct!", "You correctly found…") is taken out;
  against `partly`, whole-answer praise; against `correct`, doubt ("Not quite", "try again"); against
  `unsure`, both. "Great, but 6 x 8 is 48." keeps "6 x 8 is 48."; the first claim taken out becomes
  the verdict in one line ("That's not right yet.") unless the reply already said it. Against
  `incorrect` the same line also opens the reply when its first sentence (or a card question the child
  sees first) neither says the verdict nor had a claim taken out: replies on `gemma4:e2b` that only
  re-explained or moved on after a wrong answer read as "fine" (TerraTutor B9 rerun 2). It is decided at
  that first sentence, so the reply still streams; a reply that says it only later gets one line more
  than it needed. Not against `correct`, `partly` or `unsure`, and not on a reply left empty (the
  fallback says it). Praise includes
  the student's own answer as the subject ("72 is correct!", when 72 is theirs and not the key's),
  "that answer", a leading ✅ ✔ ☑ 💯 🎉, common phrases ("Great answer!", "You figured it out!") and
  a few Spanish and French ones ("¡Muy bien!", "Très bien !"). A question is not read, but the
  statement before it in the same sentence is ("Great job, can you tell me how you got 72?" keeps the
  question); a request for another go ("Can you try again?") is doubt even as a question. Not claims:
  conditions, instructions ("make sure you multiply correctly"), words about another of several
  answers ("You got the first one right"), and anything in code. That last holds only when the answer
  checked is one answer: when two questions were keyed together ("63; 72") and the verdict on both is
  `incorrect`, "Your first answer is correct" praises part of it and is taken out. Praise for some of
  the answer ("You got some of the notes correct") is praise for a part. Doubt includes "Those notes are
  not correct.", "That is not the verb in that sentence." and "The word for 'cat' in Spanish is
  different." A reply left empty says the verdict
  (`VERDICT_FALLBACK`). An `ask_user.question` card is the tutor speaking too: its question and choice
  labels go through the same filter (a label gets no verdict line, and a bare "Yes!" stays); a card
  left with no question or under two choices is not shown, and the model is told (`CARD_REFUSED`).
- **Mastery claims, in a mastery check.** "You have mastered…", "I will mark that as mastered" and the
  like are taken out unless a `progress.mark_mastered` call saved a `mastered` mark earlier in the same
  turn. Rules about mastery ("A skill is marked as mastered after the quiz") are not claims. Outside a
  check they stay: the system prompt asks the tutor to say which subtopics the record shows mastered
  (`curriculum.ts`), and a rule on every turn removed true sentences. On a checked answer whose
  verdict is not `correct`, a `mastered` mark is refused by code (`MASTERY_REFUSED`); `practiced`
  still runs.

The turn result carries `answerCheck` (question, key, verdict, how it was reached) and `removedClaims`.
`TutorTurn.answerCheck: "off"` turns the check off for an eval's paired baseline. Cost on a checked
turn: one structured call, two when code cannot settle it; each is its own short prompt, so on Ollama
the reply then re-prefills the system prompt once. Known limits: the key is only as good as the model
on that question (a wrong key on a non-arithmetic question can mark a right answer wrong when the
grader agrees with it); a claim worded outside the filter's patterns gets through (in any language
but English, most do); a mastery claim in the same model call as the mark that saves it is taken out.

A model can also write a tool call as plain reply text that Ollama never parses (gemma4:e2b writes
`progress.mark_mastered{status:<|"|>mastered<|"|>,...}<tool_call|>` without its opening frame). Every
model call's text goes through `ReplyTextFilter` (`kernel/textToolCalls.ts`) before the student sees it
or it is saved: text that could still become such a call is held back mid-stream, a complete one is
removed, and gemma4's own control tokens are dropped (look-alikes such as `<|y|` are kept). Nothing
inside an open code fence is read as a call. A call that does not close (1,500 characters outside its
strings, 20,000 in all, a blank line outside a string, or the end of the stream) is given up on. Text
inside one of its strings is never shown: an unclosed `<|"|>` string is removed to the end of the
stream (unless, after the last `<|"|>`, a `}` is followed by a blank line or `<tool_call|>`: one stray
quote token, and the call ends there), an unclosed `"` string to the blank line that ends it. Otherwise only the call's first line is
removed and the rest is shown. Some calls then run, dispatched exactly like a
native call (zod validation, the permission gate, the result back to the model, `fromText: true` in the
turn's `toolCalls`), and the text after them is not shown. Which ones: the tool must be offered this
turn; `progress.mark_mastered` never runs from text (quiz and test scores decide mastery); a tool that
writes runs only when gemma4's own `<|tool_call>` or `<tool_call|>` token frames it, since bare
`name{...}` text can be an echoed note; a read-only tool may run from bare text. Every other call is
only removed. Saved replies are shown through the same filter (`displayReplyText`), so a reply saved
before it existed shows clean too.
A turn that ends with nothing to show and drew no answer card (the model wrote nothing, or only a
call the filter removed) is never left blank: the kernel shows and saves `MIXED_UP_REPLY` from
`plain-language.ts` ("Sorry, I got mixed up. Can you ask that again?"). Only a `math.render` or
`diagram.render` card that drew, or the flashcard the app made because the child asked for one, may be
the whole answer (`TutorEngine.ts showsAnswerCard`). Any other tool leaves only a chip, which is not
saved and answers nothing: when such a tool round ran with nothing shown yet this turn, an empty model
call after it is made once more with the same request, and a second empty one gets `MIXED_UP_REPLY`.
After the child answers a question card the turn always gets a reply too (Question cards, above). A turn
the student stopped, or one that stalled, keeps its own handling. A stall includes Ollama ending the
reply with an `{"error": …}` line after part of it was shown (its model runner crashed or ran out of
memory while the server stayed up), exactly as when the stream breaks off: what was shown is saved
with its marker (`persistedReply`).

In the chat, a ```` ```mermaid ```` fence in a reply is drawn by the same `MermaidBlock` a
`diagram.render` result uses (`mermaid-source.ts`), and read aloud as "A drawing". Mermaid the model
wrote with no fence (a "mermaid" line and then `graph TD`, or a diagram's first line on its own) is
fenced first (`fenceBareMermaid`) and treated the same way. Source Mermaid cannot parse is retried with
its node labels quoted inside their shapes (a circle stays a circle), then, for a flowchart, without
`}`s at its end that close nothing; if that fails too, the child sees a plain sentence and the
diagram's labels, never the source.

## AI disclosure and the break reminder (`ai-notice.ts`, `break-reminder.ts`)

California SB 243 (in effect since 2026-01-01) describes, for a companion chatbot a minor uses, a
clear notice that the chatbot is an AI and not a person, and a reminder at least every three hours of a
continuing conversation that it is not a person and that the user should take a break. The law has no
exemption for education. The app implements that disclosure and that 3-hour reminder; it makes no
claim about the law, and counsel decides whether the law applies to the app. Both are plain copy chosen
by code, with no model call.

- **The disclosure** (`AI_DISCLOSURE`: "OpenEdu's tutor is an AI, not a person.", in the product's name
  from `product.ts`) sits in the course chat's header, next to the tutor persona's name, and is on screen
  from the first message to the last, not only while the chat is empty.
- **The reminder** shows as a banner at the top of the app (the same kind as the course-ready notice:
  `role="status"`, a ✕ to close it, nothing blocked) after 3 hours of continuous activity, and again
  after each further 3 hours (6, 9, …). Its words (`breakReminder`) say the tutor is an AI, not a person,
  and suggest a break. For K-2 (`grade.ts isEarlyReader`) they are three sentences of under ten everyday
  words each, which `speech.ts` reads aloud unchanged: "Time for a break! Your tutor is an AI, not a
  person. Go stretch, play, or get a drink." Older learners and learners with no grade get how long
  they have been learning.
- **What counts as continuous** (`tickBreakClock`, pure, tested with a fake clock). The clock ticks on
  the same active minute as the daily goal (`daily-goal.ts countsTowardGoal`: the window visible, a
  learner in, a learner's own screen, not Settings), in App's one-minute timer. A gap of 30 minutes or
  more between one active minute and the next (the window hidden or minimised, Settings open, the
  learner away) is a break and starts the count again; a shorter gap does not, and its minutes are not
  added. Every learner screen counts, not only the chat: over-counting shows the reminder early, never
  late. The count belongs to one session: it starts at zero when a learner comes in (a switch resets
  it) and is not saved, so it also starts again after a restart.

## The safety notice for a pregnancy (`child-safety.ts strongPregnancy`)

With a K-12 grade set, a strong pregnancy self-disclosure in the learner's message ("am i pregnant", "im 14
and pregnant", "i missed my period", "my pregnancy test was positive") is a safety disclosure: ChatTab shows
`SAFETY_NOTICE` under it, and in a mastery check it is not graded as an answer (the answer check's "When",
above). Typed as a quiz or level-test written answer, a "why is that the answer?" or a new-course topic, it
gets the same notice and is not marked (the written-answer grading's "A safety disclosure typed outside the
chat", above). With no grade set nothing changes. The notice never blocks an answer, so a missed
disclosure costs far more than an extra notice, and the guards that keep jokes, pretend play, language lessons
and someone else's words quiet are kept narrow (the lead's decision after TerraTutor #161's second final
review, which the two repos share):

- There is no "pregnant with <thing>" guard. "im pregnant with my boyfriend", "im pregnant with nobody to help
  me" and "im pregnant with nowhere to go" get the notice, and so does "im pregnant with tacos". A laughing
  emoji anywhere (unless the message also shows distress) and "food baby" in the cue's clause still make it a
  joke.
- `PRETEND_FRAME` is a fixed list (play house, pretend, toca boca, the school play, ...). A pretend game set up
  in an earlier sentence that is not on it ("we're playing school. im the teacher and im pregnant") gets one
  notice; a wider frame could hide a real disclosure.
- Having a baby next to the learner's own age (10 to 17) counts in either order, with one "with" phrase
  allowed between "a baby" and the age join: "with" a name or "him", or "with my / his / a / an / the ..." and
  up to three words before a person word ("im having a baby with my boyfriend and im 15", "im having a baby
  with my 17 year old boyfriend, im 14"), never a parent or the family ("im having a baby with my mom and im
  11" is family news). The same regex as TerraTutor's `WITH_SOMEONE`; `strongPregnancy` is identical in
  both repos apart from comments. A sibling or cousin ("a baby sister"), someone else's baby and family news ("were
  having a baby") stay quiet.

`src/lib/child-safety-pregnancy-corpus.json` holds every input both repos' reviews ruled on, tagged by source:
`strong` (the notice), `notStrong` (no notice) and `acceptedExtraNotice` (the notice, accepted under the
decision above). `child-safety.test.ts` runs all of it through `isSafetyDisclosure` at every grade and with
none.

## Whether a lesson was checked (`ai-notice.ts`, migration 22)

Fable's decisions, 2026-11-16. The default 8 GB model, `gemma4:e2b`, was measured writing a major false fact
in 11 of 80 held-out lessons on grade 4 and 8 school topics, on a close copy of OpenEdu's `generateLesson`:
the same model, schema, `lessonIssues` checks and tier handling, with one paragraph added to the lesson
prompt (a topics-left-to-parents rule, with a rewrite when a lesson touches those topics). Two rounds of
local fixes did not move it. OpenEdu writes lessons that way on the same default, so it says so, in two
places, keyed on whether a cloud Checking model other than the writer actually read a lesson, not on the
machine. Every word and every choice is in `ai-notice.ts` (pure, tested in `ai-notice.test.ts`); the
components only draw it. The copy never says "your child": the reader may be a grown-up or the learner, so
it names no person where a sentence works without one, and says "the learner" where it needs one.

- **The grown-up note, "About the lessons"** (`lessonsNote(input)`), as the description above the Checking
  model picker in Settings › Models (`views/settings/LessonsNote.tsx`), always shown; OpenEdu has no
  grown-ups view, so this is the only place. Its input comes from `store.ts getLessonsNoteInput`: both
  models from `getLessonConfigs` (`config` writes, `review` checks: the same call the Lessons tab writes
  with, so a cloud checker needs its saved key and that company's one-time notice), which cloud providers
  have a key saved here, and the one-time notices confirmed here. The first body that holds:
  1. *checked* (`LESSONS_NOTE_CHECKED`) when lesson checking resolves to a cloud model that is not the course
     model (`lessonCheckCounts`; a Checking model on this computer, however big, is not "checked");
  2. *self-review* (`LESSONS_NOTE_SELF_REVIEW`) when it resolves to the cloud course model itself, which is
     what the default "Same as the course model" does with a cloud course model, or an explicit pick of the
     same model (`sameModel`: provider and model name, trimmed, case-insensitive). "That is not a second
     check, and we do not count it as one";
  3. *unchecked, cloud course model* (`LESSONS_NOTE_UNCHECKED_CLOUD`; OpenAI, Anthropic, or an Ollama model
     whose name ends in `cloud`): no number, since no cloud writer has a held-out false-lesson rate ("We have
     not measured how often…"), and no "on this computer", since the lessons are not written here;
  4. *unchecked, `gemma4:e2b` on this computer* (`LESSONS_NOTE_UNCHECKED_E2B`; the course model is exactly
     `MEASURED_COURSE_MODEL` on Ollama, trimmed, case-insensitive): the one body with a figure, "about 1
     lesson in 7", with its provenance in the copy (Fable's decision: "The test ran on a close copy of
     OpenEdu's lesson writer, not this exact one, so treat the number as a guide."). It also says the test
     was on school topics for grades 4 and 8, since an OpenEdu learner types any topic. The provenance
     sentence goes only when OpenEdu's own `generateLesson` has a held-out `gemma4:e2b` run, and the figure is
     then that run's;
  5. *unchecked, any other local course model* (`LESSONS_NOTE_UNCHECKED`): no number, since no other local
     model has a held-out false-lesson rate.

  One more line follows in some states, and turns nothing on. In states 2 and 3,
  `LESSONS_NOTE_NUDGE_DIFFERENT` ("A different cloud model can check new lessons…"), since the default
  Checking model is the self-review. In states 4 and 5, `LESSONS_NOTE_NUDGE_LOCAL` ("You have a cloud model
  set up. It can check new lessons…", Fable's decision), only when a cloud provider is already set up here:
  an OpenAI or Anthropic key is saved and that same company's one-time notice was confirmed. Without that it
  never shows: for anyone who has not chosen cloud use it would be an upsell. State 1 has no extra line.
  Both nudges say exactly what a lesson review is sent (`buildLessonReviewMessages`: "the course topic as
  the learner typed it and the lesson text, and nothing else"), never "nothing about the learner", which
  overclaims when the topic itself is personal. No link (the note sits above the picker), no model names,
  tiers, RAM, price, paid edition or upgrade, and no number anywhere but the e2b body.
- **The lesson's status line** (`lessonStatusLine`), one caption line (`--ink-faint`, 14 px, no icon, no
  colour) at the foot of the lesson reader (`LessonReader.tsx`). Four lines by checked and by K-2
  (`grade.ts isEarlyReader`); "checked" always says "It can still be wrong."; each ends "If something looks
  wrong, look it up." (Fable's wording for a learner on their own: OpenEdu has no grown-up set up to ask).
  The lesson reader's speaker button reads the lesson only, so the line is never read out. Raise hand gets no line of
  its own. A self-reviewed lesson reads as unchecked; there is no third state.
- **"Checked" is stored per lesson, at write time, never read from a setting.** `curriculum.ts
  generateLesson` writes a `lesson_checks` row (migration 22: `lesson_id`, `checked_by` as
  `<provider>:<model>`, `checked_at`) only when its Checking model was a cloud model that was not the model
  that wrote that lesson (`content-review.ts cloudCheckedBy(review, config)` → `ai-notice.ts
  lessonCheckCounts`, compared against `generateLesson`'s own `config`, not the setting; another model from
  the same company counts, so Haiku writing with Sonnet checking is checked), and the review that read the
  saved text settled every part of it (`reviewLessonIfRan` `judgedEveryPart`, `judgesEveryItem`: the summary,
  each section and each takeaway, each with an "ok" or a flag the code acts on; the first review when it
  flagged nothing, else the one on the regeneration). A reply that skips a part, `{"verdicts":[]}` included,
  still has its flags acted on but leaves the lesson unchecked. So does a flag `parseReviewFindings` throws
  away (a `false_fact` whose quote is not in the lesson, or whose `statement_is_false` is not true): nothing
  is rewritten or dropped for it, so that part was neither passed nor acted on. A self-review still runs and its flags are still acted on;
  only the label differs.
  Everything else reads as unchecked (`db.ts lessonWasChecked`): lessons written on this computer only,
  lessons whose review was off (the tiny and small tiers' default), failed or never reached the saved text,
  self-reviews, and every lesson written before migration 22. A failed write of the row leaves the lesson
  unchecked. The rows go with their lessons (`ON DELETE CASCADE`; sqlx sets `foreign_keys=ON` on every
  connection). `db-lesson-checks.test.ts` runs the real `generateLesson`, the real migrations and the real
  `getLessonConfigs` and `getLessonsNoteInput` for each case, with cloud models tiered large as `llm.ts`
  tiers them: a cloud course model on the default Checking model, an explicit pick of the same model and a
  case/whitespace variant of it (reviewed, not checked), Haiku writing with Sonnet checking (checked), and an
  Ollama `gemma4:e2b` writer with an OpenAI key saved and its notice confirmed on the default Checking model
  (unchecked, the e2b body and the local nudge).

## Raise hand (`raise-hand.ts`, `components/RaiseHand.tsx`)

Help a learner gets by tapping, never by typing. A **Raise hand** button sits in the lesson reader's
header and under the card in Review. It is not in the quiz or the level test, where help would change
the result. Pressing it opens a small panel, "Your tutor" with the AI disclosure under it, that has no
text box: the learner taps what is tricky, reads (or hears, through the app's read-aloud) one kind of
help, and answers "Did this help?". No moves on to the next kind; after two Nos the panel offers one
more way (the third kind) and "Try typing to your tutor", which opens the course chat with its box
filled in for that subtopic. Buttons are 56 px tall and the labels are a few short words.

- **What is stored.** Each lesson has 3-5 *stuck points* in `lessons.help_json` (migration 21): a label
  in the learner's voice ("What does denominator mean?", at most 8 words) and three kinds of help:
  `another_way`, `example` (worked, with the answer), `hint`. A lesson starts with another way, practice
  with a hint (`helpOrder`).
- **When it is written.** `generateLesson` writes them right after the lesson, on the same model, in one
  structured call (`writeLessonHelp`, `emit_stuck_points`, validated by `stuckPointIssues`: distinct
  labels, short labels, no cut-off help). With a Checking model the help is fact-checked like the lesson
  (`helpAsLesson` → `reviewLesson`) and a stuck point with a flagged part is dropped. A failure saves the
  lesson without help. A lesson written before this has none: the first Raise hand writes them the same
  way (`curriculum.ts lessonHelpFor`) and saves them. In Review, a card's subtopic with no lesson yet
  gets its lesson written first, with its stuck points (`lessonWithHelp`), so it then shows on the
  Lessons tab too.
- **What goes in.** The course topic, the syllabus subtopic's title and key concepts, and the lesson
  text (`buildStuckPointsPrompt`). Never a card's text (a learner may have written it), a chat, a note, a
  grade, a name or a result. The same request for every learner, so in TerraTutor it may go to a cloud
  model at any age (lane 1 of its `docs/CLOUD-PRIVACY.md`).
- **During a session nothing calls a model.** Tapping reads the stored help; `handStep` (pure) picks the
  next screen. "Did this help?" answers live in the panel's state and are never saved or sent. Nothing
  rephrases the stored help.
- **Tests.** `raise-hand.test.ts` runs the real migrations and `db.ts` on in-memory SQLite with canary
  strings in a learner's chats, notes, cards, knowledge files and name: a session on stored help makes
  no model call and no network request, and writing stuck points (with the lesson, or later for an older
  lesson, from the reader or from Review) sends exactly the prompt and its review, identical for a fresh
  learner and one with a history.

## Notebook & retrieval (`notebook.ts`, `notebook-links.ts`)

The notebook is an Obsidian-style vault: notes in nested folders, a live-preview CodeMirror editor, and a
force-directed vault graph. **`notebook-links.ts`** is the pure source of truth for `[[wiki link]]` /
`#tag` parsing, link resolution, the tag index, and the graph builder (note / folder / tag nodes). Tags
are **derived from note content** — no DB column. **`notebook.ts`** handles RAG: notes are chunked,
embedded on save, and searched by **brute-force cosine** over the course's vectors (fine for a single
student's vault; vectors are stored as base64 f32 TEXT in `vec_b64`, with pre-migration-12 rows read back
from JSON-array TEXT, schema kept `sqlite-vec`-compatible for later).

A note that couldn't be embedded when it was imported or saved (no embedding model yet, Ollama down) is
picked up by `reindexCourseNotes`, which `NotesTab` runs each time it opens a course's notes: it skips
notes whose entry is current, stops when the embedder itself can't run (model missing, Ollama down, no
OpenAI key or connection) and skips past a note that fails on its own. `NotesTab` runs every index job
(that pass, embed-on-save, a deleted note's clean-up) one at a time, so one note never gets two entries. Each
note gets its own editor (`MarkdownEditor` keyed on the note id), so undo history never crosses notes;
a save writes the note it was handed and never re-selects it, and deleting a note takes a second click
on the trash button.

Linking is bidirectional. `buildBacklinkIndex` maps a note to everything holding a `[[link]]` that
resolves to it, with the surrounding line as context; `findUnlinkedMentions` finds notes that say the
title in prose without linking it. **These two are reported separately and must stay that way** — a
linked mention is a fact about the vault, an unlinked one is only a suggestion, and merging the counts
would assert a relationship that doesn't exist. Unlinked matching is deliberately conservative
(whole-word, titles under 3 characters skipped) because a suggestion that fires constantly is worse than
one that never fires.

`extractOutline` gives the heading tree, skipping fenced code blocks. `wikiLinkPrefix` backs the `[[`
autocomplete and lives here rather than in the editor so the matching rule is testable without a
CodeMirror instance. `NotesTab` renders outline + both mention kinds in a toggleable right rail;
`lib/fuzzy.ts` powers the Ctrl/Cmd+O quick switcher with subsequence (not edit-distance) matching.

Two invariants worth not breaking:

- **`WIKI_LINK_RE` must exclude newlines.** Without that, one stray unclosed `[[` swallows everything up
  to the next `]]` later in the document, inventing a link whose title spans paragraphs — which then
  becomes a real edge in the graph and a row in backlinks.
- **A missing `[[link]]` never auto-creates.** It renders dashed, and creating is an explicit action.
  Autocomplete offers existing titles only, and the quick switcher can't create at all.

## Design system

The UI is the **Notebook** look (warm paper, navy ink, one blue accent, Lexend throughout) defined
entirely with CSS variables in `src/index.css`. The variable names are still the CRT-era ones
(`--phosphor` is the accent, `--ink` body text, `--rule`, `--panel`, …) so components didn't need edits;
renaming them is a later change. Two modes: light is the bare `:root`, dark is `html[data-theme="dark"]`.
`src/lib/theme.ts` stores the user's choice (Light / Dark / Match my computer, which follows
`prefers-color-scheme` live) and applies it pre-paint in `main.tsx`. CRT-era theme ids still sitting in
localStorage or in exported settings files are mapped by `normalizeThemeChoice`: unset, `openedu` or
anything unknown → light; every recolor (`amber`, `synthwave`, …) → dark. The CRT overlay and the
"CRT off" preference are gone. **Use the tokens, not hardcoded colors**, so everything works in both
modes. Settings has its own [architecture README](../src/views/settings/README.md).

`design/` holds a browsable version of the same system, built by `npm run design` into self-contained
HTML cards and pushed to Claude Design, which then generates new work using these colours, type, and
components. `design/authored/` is committed source; `design/dist/` is generated and gitignored. The
generator inlines `index.css` verbatim rather than parsing it for values, so a parse bug produces a
wrong label beside a correct swatch instead of a wrong design.

Two things to know if you touch it:

- **`data-theme` on a descendant is not the same as on `<html>`.** Derived tokens (`--rule`,
  `--ink-dim`, `--phosphor-faint`) are declared on `:root`, so their `var()` resolves there and is
  inherited already-computed. The app never hits this because `data-theme` lives on `<html>` — the same
  element as `:root` — but any preview that scopes a theme to a `<div>` must re-emit the derived tokens.
- **Tailwind utilities lose to unlayered CSS.** `.btn-primary` in `index.css` is unlayered; utilities
  live in `@layer utilities`. So `class="btn-primary text-white"` renders the accent, not white. This
  bit us once — 24 `text-white` classes that had never done anything.

## Testing & CI

- `npm test` — Vitest over the pure logic modules (no DOM/Tauri). Add a `*.test.ts` for new pure logic.
- `npm run build` — `tsc` typecheck + Vite bundle.
- CI (`.github/workflows/ci.yml`) runs both on every PR **regardless of what it targets** — PRs here are
  commonly stacked, and filtering on the base branch would leave every PR above the bottom of a stack
  unchecked. DOM-coupled UI is verified live in `npm run tauri dev`.

## Releases & updates

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds, **signs**, and publishes a
GitHub Release with the installers and the updater manifest (`latest.json`). Installed apps update **only
when the user presses Check for updates** in Settings → About — offline-first means no check at launch.
The release notes (shown beside that button) are extracted from that version's section in
[`CHANGELOG.md`](../CHANGELOG.md) — so keep the changelog current and bump the version in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together.
