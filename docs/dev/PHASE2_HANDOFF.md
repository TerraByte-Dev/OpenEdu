# Phase 2 Handoff — v2 Skills + Permission Layer

**Written:** 2026-05-24 · **For:** the next session, which will **plan Phase 2** (start in plan mode).
**Status going in:** Phase 1 shipped and squash-merged to `master` (`f84aa33`, PR #7). master is the true current version.

> This is a planning brief, not a spec. Read the canonical docs below, then plan. Line numbers are
> from 2026-05-24 — verify before relying on them.

---

## Read first (in order)

1. **This file.**
2. `V2_ARCHITECTURE.md` — §6.1 (Skills), §7 (Permission layer), §5 (system-prompt layers — the `<skill_bundle>` layer #3), §8 (DSL — `skill.ts`), §9 Phase 2.
3. `CLAUDE.md` — invariants and DON'Ts.
4. Memory: `openedu_v2_harness_migration`, `feedback_defer_sidework_to_roadmap` (and the index in `MEMORY.md`).

---

## Where things stand — Phase 1 filled the kernel seams; Phase 2 adds skills + permissions

Phase 1 shipped a real kernel turn loop, native streaming tool-calling, and the first 3 tools, all
verified on `gemma4:e4b` (streaming+tools spike **1.00**, evals **5/6**, all 3 tools confirmed in-app).
What Phase 2 builds on:

| File / area | What's there now (Phase 1) | Phase 2 does |
|---|---|---|
| `src/lib/tools/` | `EduTool` contract, registry, 3 tools (`knowledge.update_map`, `progress.mark_mastered`, `ask_user.question`), `registerBuiltinTools()` | skills declare `tools_required`; tools get gated by the active skill |
| `src/lib/kernel/toolDispatch.ts` | `selectTools(ctx)` returns **all** enabled tools, with a documented routing seam | make `selectTools` skill/mode-aware — return only the active skill's `tools_required` (+ always-on read tools) |
| `src/lib/tools/EduTool.ts` | `ToolContext` = courseId, level, syllabus, modelTier, **permissionMode** (unused, always `"default"`), config, abort, askUser | add the active skill/mode; make `permissionMode` real |
| `src/lib/kernel/systemPrompt.ts` | `assembleSystemPrompt` (v1 passthrough) + `toolsLayer` (`<tools>`) | add the `<skill_bundle>` layer (§5 #3) — inject the active skill's persona/rules |
| `src/lib/tutor-modes.ts` | 5 modes as **prompt-suffixes** (`explain/socratic/quiz/review/hint`) | convert to skills (`.md` + frontmatter); **add the new `assess` skill** |
| `src/lib/dsl/` | zod DSLs + `toProviderJsonSchema` | add `skill.ts` frontmatter schema (§8) |
| `src/lib/eval/` | 6 goldens, **5/6** (`tool-mark-mastered` passing; `math-word-problem` the known LaTeX fail) | hold ≥ baseline; add a skill-gated golden |

---

## Locked decisions — do NOT reopen

- **zod is the schema source of truth.** **Native streaming tool-calling is primary** — confirmed 1.00 on `gemma4:e4b` (`V2_DECISION_TOOLCALL.md`).
- **`ToolContext` is all a tool gets.** Extend it additively (Phase 1 added `config` + `askUser`).
- **The `assess` skill is already scoped** (V2 §6.1 + §9): a mastery-check mode/skill binding `progress.mark_mastered` + `ask_user.question`, replacing the awkward free-text "mark X off my syllabus." `progress.mark_mastered` already resolves a subtopic by **title or id** (Phase 1 fix `23ac049`).
- **Skill/mode-gated tool exposure is a goal, not just cleanup** — it also curbs the floor model's stray/hallucinated tool calls seen in Phase 1 (gemma faked a "✓ Concept Map Update" in prose).
- **Invariants:** integer levels 1–6; never modify shipped `tauri-plugin-sql` migrations (1–5 load-bearing); no LaTeX in chat strings (Phase 4's `math.render`); no `deleteCourse` on pipeline error.

---

## Phase 2 scope (to be planned — from V2 §6.1 / §7 / §9)

1. **Skill system.** Loader (built-in `src/skills/<name>.md` + user `%APPDATA%/com.terrabyte.openedu/skills/`), frontmatter parser, trigger matcher. Add a `skill.ts` zod DSL (`src/lib/dsl/`): `name, description, trigger.course_subject[], tools_required[], model_tier_min`.
2. **Convert `tutor-modes.ts` → skills:** `socratic.md`, `quiz-mode.md`, `review.md`, `hint-only.md`. The mode-bar UI in `ChatTab` stays — it now selects a *skill*.
3. **New `assess` skill** — mastery-check: `tools_required: [progress.mark_mastered, ask_user.question]`; runs a short readiness check over the current level's *unmastered* subtopics.
4. **Skill/mode-gated tool exposure** — thread the active skill into `ToolContext`; `selectTools` returns only that skill's tools (plain "Explain" → no action tools).
5. **`<skill_bundle>` system-prompt layer** (§5 #3) — inject the active skill's persona/rules; compose with the existing `<tools>` layer.
6. **Permission layer** (§7) — `ToolPermissionContext`, `permissions.json` in `%APPDATA%`, the allow/ask/deny table per mode (default/study/exam), Settings UI page. (Exam-mode hot-swap *during promotion tests* may defer wiring to Phase 5; scaffold the structure here.)
7. **Skill discovery on small models** (§11.3) — code-route by `course.subject` for tier ≤ small; let tier ≥ medium choose. (Recommended: yes, code-route.)
8. **Eval** — hold ≥ **5/6**; add a golden proving skill-gating (e.g. `assess` marks mastery; "Explain" does **not** call action tools).

---

## Open questions to resolve while planning

- **How does the active skill live in `ToolContext`** and how does `selectTools` read it — a mode id, or a resolved skill object?
- **Replace vs wrap `tutor-modes.ts`** — V2 says convert to skills; the mode-bar UI stays as the selector. Decide the migration shape.
- **Permission depth for Phase 2** — full allow/ask/deny + Settings UI now, or scaffold the layer with allow-all and the rules structure in place (Phase 1 was allow-all)?
- **"ask" permission UX** — reuse the `ask_user` inline-button pattern, or a distinct permission prompt component?
- **Trigger vs explicit selection** — auto-load skills by `course.subject`, the mode-bar selector, or both?
- **Eval safety** — converting modes→skills changes prompt assembly; keep the 5 baseline goldens' *effective* prompt equivalent so 5/6 holds.

---

## Gotchas

- **Branch off `master`** (now current at `f84aa33`).
- Don't run `npm run tauri dev` / `cargo build` while the user is away.
- `permissionMode` already exists on `ToolContext` (default/study/exam/bypass) but is unused — Phase 2 makes it real.
- The 5 baseline goldens are sensitive to system-prompt changes — the modes→skills conversion must not regress them.
- Don't reopen the streaming / tool-dispatch decisions (settled in `V2_DECISION_TOOLCALL.md`).

---

## GitHub flow for Phase 2

New issue ("Phase 2: skills + permission layer (+ assess skill)") → branch `feat/<n>-v2-phase2-skills` off `master` → draft PR → `Closes #<n>`. (Phase 0 = #3/#4, Phase 1 = #6/#7.)

## Verification target

`tsc` + `npm run build` green · `window.__runEvals()` ≥ 5/6 (+ a skill-gating golden) · existing modes still behave (now skill-backed) · `assess` mode marks mastery, "Explain" offers no action tools · permission rules enforced (at least scaffolded) · manual: switch modes and confirm tool availability changes.
