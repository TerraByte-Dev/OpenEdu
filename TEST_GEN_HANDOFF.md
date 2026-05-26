# Test Generation Fix — HANDOFF (quiz / promotion-test JSON failure)

**Status:** Diagnosed 2026-05-26, root cause pinned. **Fix direction is PROPOSED, not locked — plan it in-session with Tate before coding.**
Separate from the chat-render fix (PR #24, which works). This is a pre-existing "remnant of old stuff" bug.

## Symptom
Generating a test fails with a JSON error. Surfaces in the UI as a red error box (the raw `JSON.parse`
`SyntaxError` message) and the test screen falls back to "ready" — no questions generated.
Affects both the per-level **quiz** and the **promotion test**.

## Root cause (PINNED — evidence below)
`src/lib/quiz.ts` is the **only generation module never migrated to the v2 agent harness.** Everything in
`curriculum.ts` uses `callLLMStructured` (provider-native schema enforcement + local validator + repair-retry
— the thing that made generation reliable on `gemma4:e4b`). `quiz.ts` still uses the **old** approach:

- `generateQuizQuestions` (`quiz.ts:62`) and `generatePromotionTestQuestions` (`quiz.ts:239`) call **free-text
  `callLLM`** and hand the raw string to `parseQuestions`.
- `parseQuestions` (`quiz.ts:129–156`) does `JSON.parse(jsonStr)` with a single `sanitizeJsonEscapes` fallback.
  On a 4B model a 20–35-question free-text JSON blob frequently comes back **truncated** (incomplete array),
  with **stray LaTeX backslashes** (invalid escapes), or **unescaped quotes/newlines** — all of which make
  *both* parse attempts throw.
- The promotion test asks for **35 questions in one call** (`quiz.ts:209`) + 10 review. The `current` parse at
  **`quiz.ts:240` is NOT wrapped in try/catch** (only the `review` parse is, `quiz.ts:269–274`), so a single
  malformed `current` blob hard-fails the whole test. Cloud models are also capped at `max_tokens: 8096`
  (`llm.ts`), which can truncate 35 verbose questions.
- The error propagates to the view's `catch` and is shown verbatim: `PromotionTestFullScreen.tsx:129–132`
  (`setGenError(...)`); the quiz path is the same shape in `QuizFullScreen.tsx` (`generateQuizQuestions(syllabus, 20, cfg)`, `:43`).

**Live wiring:** `App.tsx:12–13` mounts the **views** `QuizFullScreen` + `PromotionTestFullScreen`.
`src/components/PromotionTestModal.tsx` is **dead code** (not imported anywhere) and is full of the **removed
0.5-increment level scheme** (`levels = [0, 0.5, 1, 1.5, …]`, `PromotionTestModal.tsx:205`) — strong corroboration
this whole area predates the integer-level + harness migration. Deletion candidate.

## Repro (do this FIRST next session — capture the literal error)
1. `npm run tauri dev` (Tate at keyboard).
2. Open a course on `gemma4:e4b`; start a **promotion test** (35 Qs — most fragile) and a **quiz** (20 Qs).
3. Open devtools console; copy the **exact** `genError` string + any `[OpenEdu]` log lines around the failed
   `callLLM`. Confirm whether it's truncation (unterminated JSON), a bad escape, or unescaped quotes — this
   picks the exact fix and gives a regression fixture.

## Recommended fix direction (PROPOSED — confirm before coding)
Mirror the harness lessons in `CLAUDE.md` ("Decompose, don't dump" / "Schema-enforced everywhere" / "Code-assemble
what doesn't need an LLM"):
1. **Migrate `quiz.ts` to `callLLMStructured`** (`llm.ts:953`). Add a zod schema for the question array in
   `src/lib/dsl/` (pattern: `dsl/course.ts`) covering all `VALID_QUESTION_TYPES` (`quiz.ts:71`). Pass a `validate`
   callback (subtopic coverage, type distribution, MC has 4 options, true_false ∈ {True,False}) so semantic gaps
   trigger repair-retry — see [[feedback_schema_semantic_validation]].
2. **Decompose the 35-question promotion test** into smaller batched/per-subtopic calls instead of one giant blob
   (tier-aware count, like `scaleSchemaMinima` / prompt compression already do for curriculum).
3. **Guard every parse** and keep `parseQuestions`'s fence-strip / `[`…`]` slice as a fallback only.
4. Keep math **plain-text** in questions (the existing `quiz.ts` rules + `MATH_FORMATTING_RULES` are correct —
   quiz JSON must stay backslash-free or it corrupts; do NOT relax this. The chat-render relaxation in PR #24 is
   chat-only and must not leak here).

## Invariants / constraints (DO NOT regress)
- **Integers 1–6 only** — do NOT reintroduce 0.5 levels (CLAUDE.md). If touching advancement, audit
  `PromotionTestFullScreen` for legacy fractional logic too.
- **Don't touch `MATH_FORMATTING_RULES` / `MATH_FORMATTING_RULES_PROSE`** (JSON-corruption + plain-text study plan).
- **Don't modify a shipped `tauri-plugin-sql` migration** (migrations 1–9 are load-bearing); add a new version if
  schema changes are needed (the `quiz_questions` table likely needs none).
- Floor model is `gemma4:e4b`; verify the fix there. Hold `window.__runEvals()` ≥ 11/11.
- Branch off `master`; **merge-commit** style; **no builds while Tate is away**.

## Acceptance criteria (ready to paste into the issue)
- [ ] Generating a quiz (20) and a promotion test (35+10) on `gemma4:e4b` succeeds reliably (≥ 5 consecutive runs, no JSON error).
- [ ] Malformed/truncated model output is recovered via schema repair-retry, not a hard crash.
- [ ] Every subtopic is covered; MC has 4 options; true_false answers are exactly True/False.
- [ ] Question math stays plain text (no `$`/backslashes in stored questions).
- [ ] `window.__runEvals()` ≥ 11/11 (no regression).
- [ ] (Cleanup) dead `PromotionTestModal.tsx` deleted or revived as the real component; no 0.5-level logic remains in the live path.

## Pointers
- Generation: `src/lib/quiz.ts` (`generateQuizQuestions`, `generatePromotionTestQuestions`, `parseQuestions`, `gradeWrittenResponse`, `generateStudyPlan`).
- Harness to copy: `src/lib/curriculum.ts` (every `callLLMStructured` call) + `src/lib/llm.ts:953` (`callLLMStructured`) + `src/lib/dsl/course.ts` (zod schema pattern).
- Views (live): `src/views/QuizFullScreen.tsx`, `src/views/PromotionTestFullScreen.tsx`. Dead: `src/components/PromotionTestModal.tsx`.
- DB: `quiz_questions` / `quiz_attempts` CRUD in `src/lib/db.ts`; mastery exam (L6) is code-assembled in `curriculum.ts:703` (no LLM — the reliability model to aim for).

## Out of scope here (separate content-QUALITY bugs — file own issues; also noted in `RENDERING_HANDOFF.md`)
- `Z` emitted as a fake element symbol (should be `Zn`).
- True/False answer set on a "chemical or physical change?" question.
- Fill-in-the-blank graded as exact-match ("nucleus" marked wrong) — see `gradeWrittenResponse` only grades written/word; fill_in_blank uses string compare in the view.
