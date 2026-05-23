# OpenEdu v2.0 — Architecture Plan

**Authored:** 2026-05-20
**Goal:** Promote OpenEdu from "structured-output chatbot with a course pipeline bolted on" to a genuine **agent harness** for tutoring. Stay desktop (Tauri). No CLI. Reference architecture: `AgentHarnessDocs/claude-code-main`.

This is a hand-off doc. Read it cover-to-cover before touching code. Existing v1 invariants from `CLAUDE.md` (no migration rewrites, integer levels 1–6, no `deleteCourse` on pipeline error) still apply.

---

## 1. The honest diagnosis

What v1 already gets right (keep, do not rewrite):

- **Structured-output discipline.** `callLLMStructured` with provider-native enforcement + local validator + repair retry is real harness work. Schema-enforced everywhere is the right default.
- **Tier detection + prompt scaling.** `detectModelTier`, `ollamaNameTierOverride`, `scaleSchemaMinima` — keep.
- **Checkpoint/resume.** `generation_state` persistence is the right pattern. The agent kernel should adopt the same idea for tutor sessions.
- **Code-assemble what doesn't need an LLM.** L6 from outline, knowledge file diffs from rules. Lean into this further.
- **Per-course memory.** `knowledge_map`, `misconceptions`, `study_log`, `learning_profile` are already a primitive memory system. They become first-class in v2.

What v1 gets wrong (the actual harness gap):

1. **The chat loop is a stream, not a kernel.** `ChatTab.sendMessage` builds a single message list, calls `streamChat`, renders the deltas. No tool-call interleaving, no plan, no stop-hooks, no per-turn token budget, no subagent spawn. Claude Code's `QueryEngine` / `query.ts` is the structural reference for what's missing.
2. **"Tutor modes" are prompt suffixes.** A real harness exposes mode-specific *tools and skills*, not a paragraph of "do X, don't Y." Today: `socratic`/`quiz`/`review`/`hint` are five strings in `tutor-modes.ts:11`. That's flavor, not structure.
3. **The Notebook tab is dead weight.** No ingestion, no embeddings, no retrieval. Tutor cannot cite student-supplied material.
4. **Output is text-only.** Locked decision in `HANDOFF.md` (no LaTeX while 4B floor holds). v2 routes math through a **structured tool call** instead of JSON-escaped chat strings — sidesteps the escape problem entirely (see §6.4).
5. **No DSL.** Tools, skills, personas, course schemas all live as inline TS const objects. Loose JSON. Hard to extend, hard to ship as "OpenEdu Skills" the way Claude Code ships skills.
6. **No permission layer.** Every action the tutor takes is implicit. There is no "ask before web fetch," no "always allow notebook search." When tools land, this matters.

---

## 2. Target architecture — the rings

Borrow Claude Code's layered ring structure, scaled to a tutoring product:

```
┌─────────────────────────────────────────────────────────────┐
│ UI layer (React)                                            │
│   ChatTab (now: harness view) · NotebookTab · OverviewTab   │
│   Inline tool-result cards · Sprite tutor · KaTeX renderer  │
├─────────────────────────────────────────────────────────────┤
│ Kernel — TutorEngine                                        │
│   Turn loop · tool dispatch · streaming · stop hooks        │
│   System-prompt assembly · token budget · checkpoint/resume │
├─────────────────────────────────────────────────────────────┤
│ Permission layer                                            │
│   Mode (default/study/exam/bypass) · per-tool allow/ask/deny│
│   Auto-approve read-only · ask on web fetch · deny by class │
├─────────────────────────────────────────────────────────────┤
│ Skill layer                          │ Subagent layer       │
│   .md bundles with frontmatter       │   research           │
│   math-tutor, code-tutor,            │   quiz-author        │
│   language-tutor, exam-prep,         │   explainer          │
│   socratic, sprite-persona-XYZ       │   curriculum-builder │
├─────────────────────────────────────────────────────────────┤
│ Tool layer — EduTool<Input,Output,Ctx> contract             │
│   notebook.* · knowledge.* · progress.* · study_plan.*      │
│   quiz.* · flashcard.* · web.* · math.render · diagram.*    │
│   code.run · ask_user.question                              │
├─────────────────────────────────────────────────────────────┤
│ Memory layer                                                │
│   Per-course: knowledge_map, misconceptions, study_log,     │
│   learning_profile · Per-student: global profile · Notebook │
│   vector index (sqlite-vec)                                 │
├─────────────────────────────────────────────────────────────┤
│ Provider layer (unchanged)                                  │
│   llm.ts — Ollama / OpenAI / Anthropic · tier detection     │
└─────────────────────────────────────────────────────────────┘
```

Each ring is reachable from the ring above it. Tools never reach into UI; UI never reaches into the provider layer. This is the discipline v1 doesn't have.

---

## 3. The EduTool contract

Single source of truth. Every other ring is built around this. Cribbed from `claude-code-main/src/Tool.ts:362-440`.

```ts
// src/lib/tools/EduTool.ts
import type { ZodSchema } from "zod";

export interface ToolContext {
  courseId: string;
  level: number;
  syllabus: Syllabus | null;
  modelTier: ModelTier;
  permissionMode: PermissionMode;
  abort: AbortSignal;
}

export interface EduTool<Input, Output> {
  name: string;                     // "notebook.search"
  description: string;              // what the model sees
  inputSchema: ZodSchema<Input>;    // validation + provider-native enforcement
  outputSchema?: ZodSchema<Output>; // structured render
  validateOutput?: (out: Output) => string[]; // semantic checks schema can't express (uniqueness, completeness). Empty = valid; non-empty triggers repair-retry, same contract as callLLMStructured.opts.validate.

  isReadOnly: boolean;              // controls auto-approve
  isDestructive?: boolean;          // forces explicit confirm
  isConcurrencySafe: boolean;       // parallelizable in a turn
  isEnabled: (ctx: ToolContext) => boolean | Promise<boolean>;

  call(input: Input, ctx: ToolContext): AsyncGenerator<ToolEvent<Output>>;

  // Optional: how the tool result renders inline in the chat surface
  renderResult?: (output: Output) => ReactNode;
}

export type ToolEvent<O> =
  | { kind: "progress"; message: string }
  | { kind: "result"; value: O }
  | { kind: "error"; error: string };
```

**Why a generator, not a Promise.** Long-running tools (web fetch, quiz authoring, notebook indexing) need to stream progress into the chat surface. Same pattern Claude Code uses for `BashTool` and `WebSearchTool`.

**Where to put them.**
```
src/lib/tools/
  EduTool.ts                  // contract
  registry.ts                 // exports all tools, gated by isEnabled
  index.ts                    // re-exports for consumers
  notebook/
    SearchTool.ts
    WriteTool.ts
    IngestTool.ts             // chunk + embed a PDF/note
    prompt.ts                 // the description text shown to the model
  knowledge/
    UpdateMapTool.ts
    LogMisconceptionTool.ts
  progress/
    MarkMasteredTool.ts
    FlagStruggleTool.ts
  study_plan/
    CreateTool.ts
    UpdateTool.ts
    ListTool.ts
  quiz/
    GenerateTool.ts           // spawns the quiz-author subagent
  flashcard/
    CreateTool.ts
    ReviewDueTool.ts          // SRS
  web/
    SearchTool.ts             // permissioned
    FetchTool.ts              // permissioned
  math/
    RenderTool.ts             // emits a KaTeX block as tool output
  diagram/
    RenderTool.ts             // emits a Mermaid block
  code/
    RunTool.ts                // sandboxed Pyodide / QuickJS in webview
  ask_user/
    QuestionTool.ts           // structured choices, inline buttons
```

Initial v2 cut: **8 tools** — `notebook.search`, `notebook.ingest`, `knowledge.update_map`, `progress.mark_mastered`, `study_plan.create/update/list` (3 tools), `quiz.generate`, `math.render`, `ask_user.question`. Ship those. Add the rest on demand.

---

## 4. The Kernel — TutorEngine

Replaces the inline `sendMessage` in `ChatTab.tsx:67`. Single owner of one tutoring turn.

```
src/lib/kernel/
  TutorEngine.ts        // top-level loop, retry, budget, cost
  turn.ts               // per-turn pipeline
  systemPrompt.ts       // layered assembly (see §5)
  stopHooks.ts          // when to end a turn
  tokenBudget.ts        // per-turn ceiling + content-replacement budget
  toolDispatch.ts       // map model tool_calls → registry → events
```

**The turn pipeline.**

```
1. processUserInput(text, ctx)        // sanitize, expand seeds, detect intent
2. assembleSystemPrompt(ctx)          // see §5
3. selectTools(ctx, skills)           // filter registry by isEnabled + skill bundle
4. callLLMStreaming({ messages, tools, schema?, abort })
5. for-await chunk in stream:
     - text → ChatTab via onText
     - tool_call → toolDispatch.run(call, ctx) → emit progress/result
     - reinject tool result into next model turn
6. shouldContinue(ctx, lastTurn)      // stop hooks
7. persistTurn(messages, toolEvents)  // checkpoint, mirror generation_state
```

**Provider tool-calling.** Already supported by all three providers in `llm.ts`. The work is wiring `tools: EduTool[]` → provider-native function/tool schema (Ollama `tools`, OpenAI `tools`, Anthropic `tools`). Reuse the existing structured-output infra; tool-calls are the same JSON-schema discipline with a different envelope.

**Keep what works.** Tier detection, schema relaxation, repair-retry, preflight all stay. The kernel calls into `llm.ts`, not the other way around.

---

## 5. System-prompt assembly (layered)

Today: `buildSystemPrompt(instructions, syllabus, level, topic, modeSuffix, knowledgeSummary)` returns one concatenated string. That's fine for v1; v2 needs structure.

Layers in order:

```
1. <env>           // app, course title, current level, syllabus title
2. <persona>       // from sprite/persona skill (was: tutor_instructions)
3. <skill_bundle>  // injected by active skills (math-tutor adds math rules)
4. <memory>        // knowledge_map summary, misconceptions, learning_profile
5. <progress>      // mastery snapshot for current level
6. <concept_ledger>// tier-aware compaction (already exists)
7. <mode>          // pedagogical mode (was: tutor-modes promptSuffix)
8. <tools>         // tool-list manifest emitted by the kernel
9. <output_rules>  // plain-text-math rule survives until 4B floor moves
```

`src/lib/kernel/systemPrompt.ts` is the single place this gets built. Each layer is a pure function `(ctx) => string | null`. Empty layers drop out.

---

## 6. Subsystems — concrete designs

### 6.1 Skills

Direct port of Claude Code's skill system (`claude-code-main/src/utils/skills/`).

A skill is a markdown file with frontmatter that lives in:
- **Built-in:** `src/skills/<name>.md` (shipped with the app)
- **User:** `%APPDATA%/com.terrabyte.openedu/skills/<name>.md` (sideloadable)

```md
---
name: math-tutor
description: Math-domain tutor. Adds LaTeX rendering, common-pitfall guidance, problem-set generator.
trigger:
  course_subject: ["math", "physics", "engineering"]
tools_required: ["math.render", "quiz.generate"]
model_tier_min: "small"
---

# Persona rules
...

# Tools you can rely on
- `math.render({ latex })` — emit a rendered KaTeX block. Use whenever an equation is the answer.
...
```

Skills get auto-loaded based on `trigger.course_subject` (matched against the course's `subject` field, which v2 adds to `courses`). Skills can also be invoked explicitly via an `invoke_skill` tool, same as Claude Code.

**Initial skill set:**
- `math-tutor` — math/physics/eng
- `code-tutor` — CS courses, owns `code.run`
- `language-tutor` — owns flashcards + SRS
- `socratic` — replaces the v1 mode suffix
- `exam-prep` — promotion-test rehearsal
- `sprite-persona-<id>` — see §6.5

### 6.2 Subagents

For OpenEdu, a subagent is **a fresh kernel turn with a narrow tool set, separate context, and a single output schema.** Same pattern as Claude Code's `AgentTool`.

Three subagents at launch:

| Agent | Tools available | Output |
|---|---|---|
| `research` | `web.search`, `web.fetch` (in research mode) | curriculum brief markdown |
| `quiz-author` | `knowledge.read`, `progress.read` | structured quiz JSON (existing schema) |
| `explainer` | `notebook.search`, `math.render`, `diagram.render` | single explanation message |

**The curriculum pipeline (`curriculum.ts`) becomes the `research` + `curriculum-builder` subagents** with the same step-by-step structure it has today. Don't rewrite it — wrap it.

### 6.3 Notebook 2.0 — RAG layer

Replaces the underwhelming `NotesTab`.

**Storage.**
- `notes` table already exists for plain text notes. Keep.
- New: `notebook_documents` (id, course_id, title, source_type [pdf|md|text|url], source_uri, sha256, ingested_at)
- New: `notebook_chunks` (id, document_id, ord, text, token_count)
- New: `notebook_embeddings` (chunk_id, vec) — backed by **`sqlite-vec`** extension (Rust-side load via `tauri-plugin-sql` extension hook, or compile into a Rust command).

**Ingestion flow.**
1. User drops a file into NotebookTab (Tauri `dragDropEnabled`).
2. `notebook.ingest` tool — chunks (~512 tokens, sentence-boundary), embeds (local Ollama embedding model — `nomic-embed-text` floor), writes rows.
3. Indicator appears in chat: "📓 *3 chunks added from 'Linear Algebra Ch. 2'*"

**Retrieval flow.**
1. Tutor decides to consult the notebook → calls `notebook.search({ query, top_k })`.
2. Tool returns top-k chunks with document titles and citations.
3. Kernel re-injects as a `tool` message; tutor weaves citations into reply.
4. ChatTab renders inline `📓 Source: Linear Algebra Ch. 2 §3.1` chips below the reply.

**Embedding model.** Ollama supports embeddings natively. Add `embedding_model` to settings; default `nomic-embed-text` (~270MB, fast). Cloud fallback: OpenAI `text-embedding-3-small`.

**NotebookTab UI.** Becomes a real document workspace: drag-and-drop, source list with chunk counts, search-box that runs the same `notebook.search` the tutor uses, "ask tutor about this document" CTA per item.

### 6.4 Math rendering — the structured-output trick

`HANDOFF.md` locks "no LaTeX in JSON strings while 4B floor holds." v2 resolves this **without** breaking that rule.

**The trick:** math leaves the JSON string entirely. Tutor calls `math.render({ latex: "..." })` as a tool call. The tool output is a structured `MathBlock` rendered by `KaTeX` in `ChatTab`. The tutor's text reply contains a placeholder `[math:1]` that the renderer swaps in. Backslashes ride inside the *tool call arguments*, which providers double-escape correctly when forced via tool schema — small models get this right far more often than free-form JSON-string LaTeX. We empirically validated the structured-output discipline works for them; this is the same discipline.

Fallback: if the model emits plain-text math instead of calling the tool, render as-is. We don't punish them for it.

### 6.5 Sprite tutors (from FEEDBACK.md)

Direct port of `claude-code-main/src/buddy/CompanionSprite.tsx` + `companion.ts` patterns.

- `src/lib/sprites/registry.ts` — 20 prebuilt sprite definitions (id, name, sheet path, personality blurb, domain hints).
- `src/components/CompanionSprite.tsx` — animated head/shoulders sprite renderer.
- One skill per sprite: `src/skills/sprite-persona-<id>.md` — encodes voice, mannerisms.
- Course creation flow gains a sprite picker. v1's free-text `tutor_instructions` generation becomes optional/legacy.
- Concept ledger and learning profile are persona-independent; switching sprite mid-course is allowed.

**Why this matters beyond aesthetics.** 4B models follow a curated persona prompt more reliably than a generated one. We've already learned generated personas are uneven.

### 6.6 Study plan as task tracker

Claude Code uses `TaskCreate/Update/List/Get/Stop/Output` as a living plan the agent maintains. For OpenEdu this becomes the **student's working plan** for the current week — and the tutor maintains it.

```
study_plan.create({ goal, due, level, subtopic_ids })
study_plan.update({ id, status: "in_progress" | "done" | "blocked", note? })
study_plan.list({ status? })
```

Surfaces as a tasklist in `OverviewTab`. Tutor reads/writes it during chat. When a subtopic is marked `practiced` in `progress.ts`, the linked task auto-closes.

---

## 7. Permission layer

Minimal viable rules:

| Tool class | Default mode | Study mode | Exam mode |
|---|---|---|---|
| `notebook.search`, `knowledge.*`, `progress.read` | allow | allow | allow |
| `study_plan.*`, `flashcard.review_due` | allow | allow | allow |
| `quiz.generate`, `math.render`, `diagram.render` | allow | allow | **deny** (no model help) |
| `knowledge.update_map`, `progress.mark_mastered` | ask | allow | allow |
| `web.search`, `web.fetch` | ask | ask | **deny** |
| `code.run` | ask | allow | ask |
| `notebook.ingest` | ask | ask | **deny** |

`ToolPermissionContext` lives on every kernel turn. Rules live in `%APPDATA%/com.terrabyte.openedu/permissions.json` and are editable in Settings. Mirror's Claude Code's `utils/permissions/` shape.

**"Exam mode"** is new. When the student takes a promotion test, the kernel hot-swaps permission mode, and the tutor literally cannot help. Removes the policy enforcement from prompt suffixes — where it belongs.

---

## 8. DSL — make the schemas explicit

Today: schemas are inline TS `const` objects (`OUTLINE_SCHEMA`, `TOPIC_LIST_SCHEMA`, etc. in `curriculum.ts:10`). They work but they're loose.

v2 promotes them to typed, named, versioned DSLs:

```
src/lib/dsl/
  course.ts         // Course<v2> schema + zod parser
  syllabus.ts       // Syllabus DSL
  skill.ts          // Skill frontmatter schema (matches Claude Code's)
  persona.ts        // Sprite persona DSL
  tool.ts           // EduTool descriptor (mirrors Tool.ts contract)
  output/
    math-block.ts   // structured math tool output
    quiz.ts         // quiz item DSL
    flashcard.ts
    diagram-block.ts
```

Every DSL has a Zod schema and a TS type derived from it. Migration: keep v1 schemas where they work; new code writes to v2 DSL only. Course rows get a `dsl_version` column; loader switches on it.

This is the piece you flagged. It's not glamorous, but it's the foundation that lets you ship "OpenEdu Skills" later the way Claude Code ships skills.

---

## 9. Migration path — six phases

Each phase ships independently. None require an `npm run tauri dev` marathon. Each ends with a working app **and a clean eval-harness run** — regression watch is non-negotiable from Phase 0 on. "Better than v1" is the bar; "feels better than v1" is not.

**Phase 0 — Foundations + spike + eval skeleton (no behavior change).** ~4 days.
- Add `src/lib/tools/EduTool.ts`, `src/lib/kernel/`, `src/lib/dsl/`. Empty registries. Tests against zod.
- Move v1 schemas into `src/lib/dsl/syllabus.ts`, `src/lib/dsl/course.ts`. Re-export from `curriculum.ts` so nothing breaks.
- **Tool-calling spike** (resolves Open Question §11.1 before any kernel code commits to a contract). Throwaway harness against `gemma4:e4b`: 5 representative tool shapes (no-arg read, single-arg search, multi-field write, enum-constrained pick, nested-object update) × 20 prompts each × `tools`-field vs `format`-field. Measure: schema compliance rate, tool-call rate (did the model invoke the tool at all when prompted to?), repair-retry count. Output: a one-page `V2_DECISION_TOOLCALL.md` selecting primary vs fallback with the numbers behind it. Commit alongside this doc.
- **Eval harness skeleton** at `src/lib/eval/` — `goldens.ts` with 5 starting conversations (math word-problem, code-debugging, language-conjugation, mid-chat mode switch, error recovery from bad tool call), each a sequence of user turns + a `success(transcript) → { pass: boolean, reasons: string[] }` validator. `runner.ts` exposed via `window.__runEvals()` DevTools hook, same pattern as `__testStructured`. Run against v1 today to establish baseline numbers; every later phase exits when its eval set passes ≥ baseline.

**Phase 1 — Kernel + first three tools.** ~5 days.
- Build `TutorEngine` and `turn.ts`. Wire `ChatTab` to call `TutorEngine.run()` instead of `streamChat`.
- First three tools: `knowledge.update_map` (already an internal function — wrap), `progress.mark_mastered` (wrap), `ask_user.question`.
- Provider-native tool-calling wired in `llm.ts` (Ollama tools, OpenAI tools, Anthropic tools).
- Ship. Chat looks identical to users; internally it's a kernel turn.

**Phase 2 — Skills + permission layer.** ~4 days.
- Skill loader, frontmatter parser, trigger matcher.
- Convert `tutor-modes.ts` entries into skills (`socratic.md`, `quiz-mode.md`, `review.md`, `hint-only.md`).
- Permission layer scaffold + Settings UI page for editing rules.

**Phase 3 — Notebook 2.0.** ~10–12 days. (Original estimate was 7; padded for the four things that are first-time work in this codebase: loading `sqlite-vec` through `tauri-plugin-sql`'s extension hook on Windows + macOS + Linux, PDF text extraction, chunking-strategy iteration on real student docs, and the NotebookTab UI rebuild. Text-only ingestion alone is closer to ~5 days — cut PDFs and the estimate halves.)
- Migration v7: `notebook_documents`, `notebook_chunks`, `notebook_embeddings`. Add `sqlite-vec` extension load to Rust side.
- `notebook.ingest`, `notebook.search` tools.
- Rebuild `NotesTab` → `NotebookTab` with drag-and-drop, document list, search box.
- Embedding model setting in `Settings.tsx`.

**Phase 4 — Math, diagrams, sprites.** ~5 days.
- `math.render` + `diagram.render` tools. KaTeX + Mermaid in `ChatTab`. Inline tool-result cards.
- Sprite registry, `CompanionSprite` component, 20 personas, course-creation sprite picker.

**Phase 5 — Subagents, study plan, exam mode.** ~5 days.
- Wrap curriculum pipeline as `research` + `curriculum-builder` subagents (no logic change).
- `quiz-author` and `explainer` subagents.
- `study_plan.*` tools + `OverviewTab` tasklist widget.
- Exam mode permission swap during promotion tests.

Total: ~33–35 dev-days of focused work (revised from the original ~29 after honest Phase 3 estimate + spike/eval added to Phase 0). Cut Phase 3 in half if you start with text-only ingestion (PDFs later) — that brings the total back toward ~29.

---

## 10. Anti-goals (what v2 explicitly does NOT do)

- **No CLI.** OpenEdu is a Tauri desktop app. The harness is internal; the UI surface is unchanged in shape.
- **No multi-user.** Single student per install. No accounts.
- **No cloud telemetry.** Bring-your-own-key principle survives.
- **No agent collaboration features (TeamCreate, SendMessage).** Tutoring is single-agent + subagents. Tabling that ring entirely.
- **No remote bridge / mobile companion (yet).** Claude Code's `bridge/` layer is a fascinating reference but out of scope for v2.0.
- **No LaTeX in chat strings.** Locked decision in `HANDOFF.md` stands. v2 routes math through a tool call (§6.4), which is *not* a violation — it's the workaround the lock anticipated.
- **No retroactive DB cleanup.** Phase 0 reads v1 rows as-is. v2 writes a `dsl_version` column; old rows render in legacy mode forever.

---

## 11. Open questions for the first session

Resolve before Phase 1 codes anything:

1. ~~**Tool-calling vs structured-output for tool invocation.**~~ **RESOLVED — see `V2_DECISION_TOOLCALL.md`.** Native provider tool-calling is **primary** (0.98 arg-compliance on `gemma4:e4b`); structured-output `format` is the **fallback** (flatten the envelope + key-repair) — it scored only **0.40** on nested/typed/enum args because Ollama's `format` grammar doesn't enforce nested property names. The §11.1 working hypothesis (provider-native primary) held; the regex-block fallback is deprioritized.
2. **Embedding model floor.** Does `nomic-embed-text` (~270MB) clear the "floor model" bar, or do we need a smaller one? Test on the same target machine as the `gemma4:e4b` floor.
3. **Skill discovery on small models.** If the tier=`small` model can't pick the right skill given a description, do we auto-select based on `course.subject` only? (Recommend: yes, code-route skills for tier≤small; let tier≥medium choose.)
4. **Where does the kernel live at runtime?** Pure TS in renderer (current) or moved to Rust? (Recommend: stay in TS for v2.0. Moving the kernel to Rust is a v3 conversation.)

---

## 12. Reference reading order for the first session

1. `CLAUDE.md` — invariants, DON'Ts.
2. `HANDOFF.md` — locked text-formatting decisions.
3. This file — top to bottom.
4. `../../../../Projects/AgentHarnessDocs/01-COMPONENTS.md` — section 1 (Agent Loop) and section 2 (Tool Layer). The mental model.
5. `../../../../Projects/AgentHarnessDocs/03-DESIGN-PATTERNS.md` — the patterns that make a harness "feel right."
6. `../../../../Projects/AgentHarnessDocs/claude-code-main/src/Tool.ts` — the EduTool contract is a direct descendant. Read lines 362–440.
7. `../../../../Projects/AgentHarnessDocs/claude-code-main/src/query.ts` — the per-turn pipeline TutorEngine mirrors.
8. `src/lib/curriculum.ts` — recognize that this is already a subagent pipeline. We're formalizing what's there.

When in doubt, the principle is: **keep what v1 got right, add what v1 was missing, and don't break locked decisions.**
