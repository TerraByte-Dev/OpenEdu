# HANDOFF — Text Formatting & Math Output Quality

**Status:** in-flight as of 2026-05-14. Start a fresh session in plan mode and read this file end-to-end before sketching the plan. Locked decisions in the **Direction** section should not be reopened without explicit user direction.

For harness conventions, schema rules, Tauri specifics, and DON'Ts, see `CLAUDE.md`.

---

## TL;DR

Small local models (target floor: `gemma4:e4b`, ~4B effective) cannot reliably emit doubly-escaped LaTeX inside JSON strings. They drop one of the backslashes, and the rest of the pipeline either crashes (`JSON.parse: bad escaped character`) or silently corrupts content (`\text{c}` decoded as `<TAB>ext{c}`, persisted in SQLite, surfaced in the UI). The fix is **suppression, not rendering** — steer the model to plain-text math everywhere, fall back to a JSON repair pass if a stray backslash slips through. KaTeX is off the table while a 4B floor is the goal.

## Direction (locked)

1. **No LaTeX in any LLM output.** Across every prompt that feeds JSON or display content, instruct: plain-text math only (× ÷ ² ³ π ≤ ≥ √ Δ θ α β μ σ Σ ∫ ∂), no backslash commands, no `$…$` delimiters, no backslashes anywhere in any string field.
2. **Defensive JSON parsing.** Every call site that runs `JSON.parse` on model output retries through `sanitizeJsonEscapes` (doubles any backslash not followed by `"`, `\`, `/`, `b`, `f`, `n`, `r`, `t`, `u`) before giving up.
3. **No math typography for now.** KaTeX/MathJax integration is deferred until either the floor model moves up or rendering quality becomes a real user request.
4. **No retroactive DB cleanup.** Pre-fix rows with `<TAB>ext{...}` corruption stay as-is; users regenerate affected courses if they care. (A migration that rewrites stored content has worse failure modes than a regen.)

---

## What already shipped this session (2026-05-13 → 2026-05-14)

**Progression redesign — Phase 0 + Phase 1 (HANDOFF previous slice)**
- Migration v6: `lessons` table + `quiz_questions.self_explanation` column
- `Subtopic.practiced?`, `Subtopic.review_needed?`, `QuizQuestion.self_explanation?`, new `Lesson` type
- Mastery threshold 0.8 → 0.9 in `src/lib/progress.ts:59`; `practiced=true` written for any subtopic with ≥ 1 tagged question seen
- `createLesson` / `getLessons` / `getLesson` / `markLessonRead` / `saveSelfExplanation` in `src/lib/db.ts`
- Overview tab is the default tab in `CourseView`; `switchTab(tab, opts?)` plumbing
- `ChatTab` accepts `seedTopic?` + `onSeedConsumed?` for deep-linking from the Next Step card
- New components: `src/components/OverviewTab.tsx`, `src/components/NextStepCard.tsx`

**Text-formatting groundwork**
- `sanitizeJsonEscapes` and `tryParseJsonLenient` in `src/lib/llm.ts` (exported)
- Lenient parse wired into `callOllamaStructured` and `callOpenAIStructured`. Anthropic's structured path returns pre-parsed objects, no change needed.
- `src/lib/quiz.ts` uses the shared sanitizer; both `parseQuestions` and `gradeWrittenResponse` retry through it on parse failure. Plain-text-math nudge added to all three quiz prompts (regular quiz, promotion current, promotion review).
- Plain-text-math nudge added to `buildTopicListPrompt` and `buildExpansionPrompt` in `src/lib/curriculum.ts`.
- Preflight timeout 30s → 90s in `src/lib/llm.ts` (`PREFLIGHT_TIMEOUT_MS`) — old ceiling was false-failing on cold Ollama loads.

---

## What's still wrong / next slice

### Prompts that still allow LaTeX (no plain-text-math guard yet)

`src/lib/curriculum.ts`:
- **Research subcalls** (5 of them, lines ~383–451): `runOverview`, `runDomains`, `runProgression`, `runObstacles`, `runPrereqs`. These feed the research brief, which is then sliced into every downstream prompt — so LaTeX leaks here propagate everywhere.
- **`generateCourseOutline` prompt** (~line 595, "You are a master curriculum architect…"). Outline JSON is persisted as `course_outline_json` and rendered as `course_outline` markdown.
- **Tutor-instruction prompts**: `identityPrompt` (~line 520) and `pedagogyPrompt` (~line 537). These shape the in-chat tutor persona.
- **`buildSystemPrompt`** itself doesn't generate content, but the *rules block* (`rules`, ~line 555) is a good place to tell the tutor to avoid LaTeX in chat output. Right now the tutor will happily emit `$\frac{a}{b}$` in markdown, which renders raw.

`src/lib/quiz.ts`:
- `gradeWrittenResponse` prompt — already parse-protected via the sanitizer, but no plain-text-math nudge.
- `generateStudyPlan` prompt — streamed plain text; no parse issue, but display can still contain stray LaTeX.

### Pre-existing DB corruption

Per **Direction #4** we don't retroactively clean. But two things worth doing in the same slice:
- Add a one-line FYI to the no-syllabus / regenerate UI (Overview + SyllabusView) explaining that older garbled courses can be cleaned by regenerating.
- Consider whether any *current* course in the user's DB has the `<TAB>ext` pattern and is worth a manual regen before the new prompt guards prove out.

### Render path

`marked.parse()` is used in `ChatTab` and `NotesTab` — markdown only, no math. Per **Direction #3** this is fine. Worth confirming the tutor-rules instruction lands so the tutor stops emitting `$…$` blocks at all.

### Test coverage gap

No automated test for `sanitizeJsonEscapes` — it's load-bearing now. A small unit test (or even a `__testSanitize` window hook like `__testStructured` in `llm.ts:1128`) covering: `\alpha`, `\frac{1}{2}`, mixed valid+invalid escapes, already-escaped content (must be idempotent), and a full malformed JSON snippet that round-trips through it would catch regressions cheaply.

---

## Recommended first slice

**One PR, ~half a day:**
1. Extract a shared `MATH_FORMATTING_RULES` constant (in `src/lib/curriculum.ts` or a new tiny `src/lib/formatting.ts`) so the rule lives in one place.
2. Append it to the 5 research subcalls, the outline prompt, both tutor-instruction prompts, the tutor `rules` block in `buildSystemPrompt`, and the two grading/study-plan quiz prompts.
3. Add a `__testSanitize` smoke hook or a tiny test for `sanitizeJsonEscapes` (idempotency + the four known-broken inputs we've seen: `\alpha`, `\frac`, `\text{c}`, `\sum`).
4. Verify end-to-end with `gemma4:e4b`: fresh course generation, no corruption in stored `syllabuses.subtopics`, no LaTeX in chat responses, quiz generation succeeds on a math-heavy topic.

After that, Phase 2 (Lessons feature) and Phase 3 (quiz interleaving + self-explanation UI) of the progression redesign can resume independently.

---

## Deferred (do not start without explicit user direction)

- **Progression Phase 2 (Lessons feature)** — `src/lib/lessons.ts`, `LessonsTab.tsx`, `LessonReader.tsx`, dedup, syllabus-suggest, deep-link from Next Step. DB surfaces (`Lesson` type, `createLesson` etc.) are already in place from Phase 0.
- **Progression Phase 3 (Quiz layer changes)** — 80/20 interleaving, `review_needed` write path on misses, self-explanation prompt in `QuizFullScreen.tsx`, `knowledge.ts` ingestion. Type + DB surfaces (`review_needed`, `self_explanation`, `saveSelfExplanation`) already in place.
- **KaTeX / MathJax math rendering.** Per Direction #3.
- **Retroactive cleanup of LaTeX-corrupted DB rows.** Per Direction #4.
- **L6 / course-completion UI** (capstone, archive, beyond-the-course) — carried over from the previous handoff.

---

## Where to read for context

- `CLAUDE.md` — harness conventions, schema rules, Tauri specifics, critical DON'Ts (esp. never modify shipped migrations).
- `src/lib/llm.ts` — `sanitizeJsonEscapes`, `tryParseJsonLenient`, `callLLMStructured`, `preflightStructuredOutput`. The bug we just fixed lives in the Ollama and OpenAI structured-parse paths.
- `src/lib/quiz.ts` — `parseQuestions`, `gradeWrittenResponse`, three prompts that already have the math rule.
- `src/lib/curriculum.ts` — research subcalls, outline, tutor instructions, `buildSystemPrompt`, `buildTopicListPrompt`, `buildExpansionPrompt`. Lines 383–451 (research), 520–562 (tutor), 595 (outline), 770+ (topic list / expansion already done).
- `UNFORMATTED_OUTPUTS.md` — Tate's original report of the symptom (the `$ ext{c}$` syllabus excerpt). Useful as a reproduction case.
