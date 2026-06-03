# Phase 1 Handoff — v2 Agent-Harness Kernel

**Written:** 2026-05-23 · **For:** the next session, which will **plan Phase 1** (start in plan mode).
**Status going in:** Phase 0 shipped and merged to `master` (`610de8f`). master is the true current version.

> This is a planning brief, not a spec. Read the canonical docs below, then plan. Line numbers are
> from 2026-05-23 — verify before relying on them.

---

## Read first (in order)

1. **This file.**
2. `V2_ARCHITECTURE.md` — §3 (EduTool contract), §4 (TutorEngine kernel), §5 (layered system prompt), §9 Phase 1.
3. `V2_DECISION_TOOLCALL.md` — the tool-dispatch decision and the numbers behind it.
4. `CLAUDE.md` — invariants and DON'Ts.
5. Memory: `openedu_v2_harness_migration` (and the index in `MEMORY.md`).

---

## Where things stand — Phase 0 built the seams; Phase 1 fills them

All scaffolding exists with **zero behavior change** (chat still goes through `streamChat`). The seams:

| File | What's there now | Phase 1 does |
|---|---|---|
| `src/lib/tools/EduTool.ts` | zod-typed `EduTool` contract, `defineTool` (infers Input), `ToolEvent`, `ToolContext`, `validateOutput` hook | author the first real tools against it |
| `src/lib/tools/registry.ts` | empty registry: `register` / `get` / `list(ctx)` (filters by `isEnabled`) | register the 3 tools |
| `src/lib/kernel/TutorEngine.ts` | `run()` **delegates to `callLLMStreaming`, no tool loop** (the explicit TODO) | build the real turn loop here |
| `src/lib/kernel/systemPrompt.ts` | passthrough to `buildSystemPrompt` | add `<tools>` layer (V2 §5.8) |
| `src/lib/dsl/` | zod schemas + `toProviderJsonSchema` (`z.toJSONSchema` + strip `$schema`) | reuse for tool input→provider schema |
| `src/lib/eval/` | 5 goldens + `window.__runEvals()`; **baseline 4/5 on gemma4:e4b** | add a tool-use golden; hold ≥ 4/5 |

Dev hooks (gated `import.meta.env.DEV` in `src/main.tsx`): `window.__runEvals()`, `window.__testDsl()`.

---

## Locked decisions — do NOT reopen

- **zod is the schema source of truth.** Tool/DSL schemas are zod; convert to provider JSON Schema via `toProviderJsonSchema` (`src/lib/dsl/jsonSchema.ts`).
- **Tool dispatch = native provider tool-calling (PRIMARY), structured-output (FALLBACK).** Spike: 0.98 vs 0.40 arg-compliance on `gemma4:e4b`; Ollama's `format` does **not** enforce nested property names. See `V2_DECISION_TOOLCALL.md`. Regex-block fallback deprioritized.
- **Invariants:** integer levels 1–6; never modify shipped `tauri-plugin-sql` migrations; no LaTeX in chat strings (math goes through `math.render` in Phase 4 — not Phase 1); no `deleteCourse` on pipeline error.

---

## Phase 1 scope (to be planned — from V2 §9 / §4)

1. **Native tool-calling in `src/lib/llm.ts`** for all three providers, reusing the existing per-call timeout / abort / repair infra:
   - **Anthropic** — generalize `callAnthropicStructured` (forced `tool_use`, ~llm.ts:886) to multi-tool `tool_choice: auto`; parse `tool_use` blocks.
   - **OpenAI** — add a `tools` + `tool_calls` path (today it uses `response_format: json_schema`, ~llm.ts:835).
   - **Ollama** — add the `tools`-field path the spike validated; read `message.tool_calls` (~llm.ts:780).
2. **The turn loop in `TutorEngine.run()`** (the current TODO): assemble messages → `registry.list(ctx)` for enabled tools → provider call with tools → for-await the stream: text→`onText`, `tool_call`→**toolDispatch**→reinject tool result → `shouldContinue` stop hook → persist. **toolDispatch**: validate args with the tool's zod `inputSchema` (`safeParse`), repair-retry on failure, run `tool.call()` generator, surface `progress`/`result` events.
3. **First 3 tools:**
   - `knowledge.update_map` — wrap the existing `updateKnowledgeFiles` logic in `src/lib/knowledge.ts` (avoid double-writing — today ChatTab calls it in the background; decide who owns it).
   - `progress.mark_mastered` — wrap `src/lib/progress.ts`.
   - `ask_user.question` — structured choices rendered as inline buttons in ChatTab.
4. **Wire `ChatTab.sendMessage`** (`src/components/ChatTab.tsx`:67) → `TutorEngine.run()` instead of `streamChat`. Render inline tool-result cards. **Plain (non-tool) turns must look identical to users.**
5. **Permission context:** `ToolContext.permissionMode` exists; Phase 1 = allow-all (the real permission layer is Phase 2). Keep `isEnabled` simple.
6. **Eval:** re-run `__runEvals()` → must hold **≥ 4/5**; add a golden that requires a tool call.

---

## Open questions to resolve while planning

- **Tool selection among many on small models** (V2 §11.3). The spike tested *single-tool* arg fidelity, not *picking the right tool* among several. Likely: code-route by `course.subject` for tier ≤ small, let tier ≥ medium choose. Validate with a quick spike if cheap.
- **Latency UX.** Native tool calls ran 6–26s on `gemma4:e4b`. Tool-augmented turns are slow → lean on the `EduTool.call` progress-event generator to stream "🔧 running …". Decide the indicator.
- **Abort/cancel** through the turn loop (TutorEngine has no signal wiring yet; ChatTab has a cancel button today — preserve it).
- **Tool-result rendering** in ChatTab without breaking the markdown stream (cards vs inline chips).
- **Kernel stays in TS** for v2 (V2 §11.4) — confirm, don't move to Rust.

---

## Gotchas

- master was ancient until today; it's current now. **Branch off `master`** for Phase 1.
- The `math-word-problem` eval fails because gemma4:e4b emits backslash-LaTeX in chat — **known weakness, Phase 4's `math.render` fixes it. Do not chase it in Phase 1.**
- Don't run `npm run tauri dev` / `cargo build` while the user is away.
- `_referenceExample.ts` in `tools/` is a compile-proof, not a real tool — safe to delete or use as a template.

---

## GitHub flow for Phase 1

New issue ("Phase 1: kernel turn loop + native tool-calling + first 3 tools") → branch `feat/<n>-v2-phase1-kernel` off `master` → draft PR → `Closes #<n>`. (Phase 0 = issue #3, PR #4, merged.)

## Verification target

`tsc` + `npm run build` green · `window.__runEvals()` ≥ 4/5 (+ a passing tool-use golden) · ChatTab identical for plain chat, tool turns stream progress then show results · manual: a chat that triggers each of the 3 tools.
