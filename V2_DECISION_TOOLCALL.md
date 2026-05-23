# Decision: Tool-invocation mechanism for the v2 kernel

**Resolves:** `V2_ARCHITECTURE.md` §11.1 (Open Question #1).
**Date:** 2026-05-23 · **Phase:** 0 · **Issue:** #3
**Status:** Decided.

## TL;DR

**Native provider tool-calling is PRIMARY. Schema-constrained structured-output ("format") is the FALLBACK.** This is the opposite of the going-in hypothesis that format would win by reusing `callLLMStructured` — the data overturned it.

## Method

Throwaway spike (`_spikeNode.mjs`, since deleted; in-app twin `src/lib/spike/toolcall.ts`). Five tool shapes authored in zod → `z.toJSONSchema()`, each invoked two ways against **`gemma4:e4b`** (the floor model) on local Ollama, **n=8** per cell (80 calls):

- **Path A — native `tools`:** `POST /api/chat` with `tools:[{type:function,…}]`; read `message.tool_calls[0].function.arguments`.
- **Path B — `format`:** `POST /api/chat` with `format:` set to an envelope `{tool, arguments}` where `arguments` is the tool's schema; parse `message.content`.

Compliance = arguments pass the tool's zod `safeParse`. Single tool offered per call (isolates "well-formed args" from "pick the right tool"). Run from Node direct-to-Ollama; the **in-app webview run reproduced the same pattern**, so the result is not an HTTP-client artifact.

## Results

| Tool shape | Path | emit | **compliance** | avg ms |
|---|---|---|---|---|
| progress_read (no-arg) | tools | 0.88 | 0.88 | 16815¹ |
| progress_read (no-arg) | format | 1.00 | **1.00** | 1366 |
| notebook_search (1 string) | tools | 1.00 | 1.00 | 6088 |
| notebook_search (1 string) | format | 1.00 | **1.00** | 2046 |
| study_plan_create (multi-field, int-bounded) | tools | 1.00 | **1.00** | 10411 |
| study_plan_create | format | 1.00 | **0.00** | 2811 |
| progress_mark (enum) | tools | 1.00 | **1.00** | 6998 |
| progress_mark | format | 1.00 | **0.00** | 2821 |
| knowledge_update_map (nested object) | tools | 1.00 | **1.00** | 26480 |
| knowledge_update_map | format | 1.00 | **0.00** | 7829 |

**Aggregate:** tools = emit 0.98 / compliance **0.98** · format = emit 1.00 / compliance **0.40**

¹ Inflated by one 45s timeout on the run's first (cold-start) call.

## Analysis

**Why `format` failed (it's field-name drift, not garbage).** The non-compliant format outputs had correct *values* but wrong *keys/structure* — Ollama's `format` grammar did **not** enforce property names or `additionalProperties:false` on the **nested** `arguments` object:
- `{"topic":"derivatives","goal":"mastery","deadline":"Friday","level":2}` — `deadline`≠`due`, extra `topic`.
- `{"subtopic":"2.3","status":"mastered"}` — `subtopic`≠`subtopic_id`.
- `{"id":"n7","label":"Chain Rule","related_to":["n2","n5"]}` — dropped the `node` wrapper, `related_to`≠`relates_to`.

Native `tools` enforced the same nested parameter schemas correctly on every call.

**Two confounds in the format path, same conclusion.** The envelope adds a nesting level *and* Ollama's nested-schema enforcement is weak. Either way, the realistic envelope we'd actually ship is unreliable for typed/multi-field/nested/enum tools on the floor model.

**Latency is the cost of the winner.** Native tools ran ~2–5× slower (≈6–26s vs ≈1.4–7.8s). The `knowledge_update_map` nested call averaged 26s. This is a real UX cost on the floor model.

**Where the paths tie:** for **no-arg** and **single-string** tools, both hit 100% compliance and `format` was ~3–5× faster.

## Decision

1. **Primary: native provider tool-calling** (Ollama `tools`, OpenAI `tools`, Anthropic `tools`). Already partially built — `callAnthropicStructured` (llm.ts:904) uses forced `tool_use`; generalize to multi-tool `tool_choice:auto`. Add Ollama `tools` + OpenAI `tools` paths in `llm.ts`.
2. **Fallback: structured-output dispatch** for models that don't support native tools, OR as a latency optimization for **simple/no-arg/single-string** tools (where it was 100% and faster). When used, **flatten the envelope** (no extra nesting) and add **lenient key-repair** (map `deadline→due`, `subtopic→subtopic_id`, etc., or re-prompt) — do not trust nested `format` enforcement on small models.
3. **Deprioritize** the regex-block `<tool_call>{…}</tool_call>` fallback from §11.1 — native tools is reliable enough that we don't need it for the floor model. Revisit only if a target model supports neither native tools nor clean format output.

## Implications for Phase 1

- **`llm.ts`:** add native tool-calling for Ollama + OpenAI; generalize the Anthropic path. Reuse the existing per-call timeout/abort/repair infrastructure.
- **`toolDispatch`:** parse `tool_calls`, validate args with the tool's zod `inputSchema`, repair-retry on failure (same discipline as `callLLMStructured`).
- **Latency → UX:** the `EduTool.call` **generator/progress-event** design (already in the contract) is now load-bearing — tool-augmented turns are slow on the floor model, so stream "🔧 running …" progress and keep tool calls purposeful.
- **Possible optimization (defer):** hybrid dispatch — `format` for no-arg/single-string tools, native `tools` for everything typed/nested. Adds complexity; only if turn latency becomes a complaint.

## Caveats

- **n=8, single model.** A large gap (0.98 vs 0.40) makes the call safe at this sample, but it's one model. Re-run `window.__spikeToolCalling()` (or the node twin) against any new floor candidate.
- **Single-tool offered.** This measured argument fidelity, not tool *selection* among many — a separate Phase 1 question (V2 §11.3 leans toward code-routing skills/tools for tier ≤ small).
- **Ollama version-sensitive.** `format` nested-enforcement behavior may change across Ollama releases; native tool-calling is the safer bet regardless.
