// TutorEngine — the kernel that owns one tutoring turn (docs/ARCHITECTURE.md).
//
// The turn loop: fit messages to the budget → select enabled tools → stream a provider turn →
// route text to onText and tool_calls to dispatch → cap and reinject tool results → re-fit → repeat
// until the model answers without calling a tool (or the iteration cap trips). A turn that offers no
// tools and uses no tool is byte-identical to the v1 streamed chat — that's the "plain chat looks
// identical" guarantee.
//
// The kernel is intentionally free of DB / React concerns. It returns the final text plus a
// summary of what happened; the caller (ChatTab) persists the message and runs the post-turn
// knowledge reflection — gated by `usedKnowledgeUpdate` so it never double-writes with the
// knowledge.update_map tool.
//
// #86 gave this loop the one thing it never had: a context budget. It used to hand the provider an
// unbounded message array with uncapped tool results and let the server decide what to drop — and
// Ollama drops from the FRONT, taking the system prompt and the tools manifest with it.

import { callLLMTurn, type NeutralMessage } from "../llm";
import type { LLMConfig } from "../../types";
import type { ToolContext } from "../tools/EduTool";
import { selectTools, buildProviderToolDefs, dispatchToolCall, type ToolUIEvent } from "./toolDispatch";
import { shouldContinue } from "./stopHooks";
import { toolsLayer } from "./systemPrompt";
import { budgetFor, fitMessages, capText, formatBudgetUsage, DEFAULT_CONTEXT_TOKENS, type Budget } from "./budget";
import { ground, groundedIn, EMPTY_GROUNDING, type Grounding, type RetrievalMode } from "./ground";

const KNOWLEDGE_UPDATE_TOOL = "knowledge.update_map";

// A single tool result may claim at most this share of the grounding slice. A notebook.search hit
// can be several thousand tokens of JSON; uncapped it evicts the entire conversation behind it.
const TOOL_RESULT_BUDGET_FRACTION = 0.8;

export interface TutorTurn {
  messages: Array<{ role: string; content: string }>;
  config: LLMConfig;
  onText: (chunk: string) => void;
  // Progress chips / result cards for tool calls. Omit in headless contexts (eval).
  onToolEvent?: (ev: ToolUIEvent) => void;
  // How retrieval behaves this turn. "always" (the default) runs the grounding stage before the model
  // sees anything; "off" disables it and leaves notebook.search as the only path. Exposed so the
  // eval can A/B the two mechanisms on the same fixture — the falsification condition needs both.
  retrieval?: RetrievalMode;
}

export interface TutorTurnResult {
  text: string;
  toolCalls: Array<{ name: string; args: unknown; ok: boolean }>;
  // True if knowledge.update_map ran successfully this turn — the caller skips its post-turn
  // auto-reflection so there's exactly one writer to the knowledge files.
  usedKnowledgeUpdate: boolean;
  // Why the turn ended. "aborted" (the student pressed Stop), "stalled" (the stream went silent) and
  // "length" (the model hit its output cap mid-sentence) all mean `text` is a FRAGMENT — the caller
  // must not persist it as a finished answer. Before #86 the done event was dropped entirely, so an
  // interrupted stream looked like a natural ending and a truncated half-sentence was written to the
  // database as the tutor's reply.
  stopReason: "complete" | "aborted" | "stalled" | "length" | "max_iterations";
  // Budget telemetry for the dev readout / diagnostics.
  usage: { contextTokens: number; promptTokens: number; droppedMessages: number };
  // What the grounding stage retrieved, and — crucially — which of it the answer DEMONSTRABLY reused.
  // `usedHits` is computed by n-gram overlap, never by asking the model whether it used the notes, so
  // a citation the student sees cannot be fabricated. Empty `usedHits` with non-empty `hits` is the
  // honest "retrieved, but answered from general knowledge" case the UI must surface rather than hide.
  grounding: Grounding;
  usedHits: Grounding["hits"];
}

export class TutorEngine {
  async run(turn: TutorTurn, ctx: ToolContext): Promise<TutorTurnResult> {
    let messages: NeutralMessage[] = turn.messages.map((m) => ({
      role: m.role as NeutralMessage["role"],
      content: m.content,
    }));

    const budget: Budget = budgetFor(ctx.contextTokens ?? DEFAULT_CONTEXT_TOKENS);
    const toolResultCap = Math.floor(budget.grounding * TOOL_RESULT_BUDGET_FRACTION);

    const eduTools = await selectTools(ctx);
    const toolDefs = eduTools.length ? buildProviderToolDefs(eduTools) : undefined;

    // Append the <tools> manifest to the system message so it matches the tools actually
    // offered. No tools → no manifest → byte-identical to the v1 system prompt.
    const manifest = toolsLayer(eduTools);
    if (manifest) {
      const sysIdx = messages.findIndex((m) => m.role === "system");
      if (sysIdx >= 0) messages[sysIdx] = { ...messages[sysIdx], content: `${messages[sysIdx].content}\n\n${manifest}` };
      else messages.unshift({ role: "system", content: manifest });
    }

    // ── Grounding stage (#90) ────────────────────────────────────────────────────────────────────
    // Retrieval runs HERE, before the model has any say in it. See ground.ts for why: asking a 4B
    // model to choose to retrieve makes grounding the product of five probabilities; running it as a
    // stage makes it 1.0. Capable models get the same context and keep notebook.search for a second
    // hop, so this is not a small-model branch.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const grounding = lastUser
      ? await ground(lastUser.content, ctx, budget, turn.retrieval ?? "always")
      : EMPTY_GROUNDING;

    if (grounding.block && lastUser) {
      // Merged into the FINAL USER TURN, not the system prompt. Two reasons, both load-bearing:
      //   Attention — on a small model an instruction sitting next to its evidence is followed far
      //     more reliably than the same instruction four sections up a ~1,200-token system prompt.
      //   Prefix cache — Ollama and llama.cpp reuse KV across an unchanged prefix. The system message
      //     and settled history are stable turn to turn; retrieved passages are not. Putting them in
      //     the system prompt would invalidate the cached prefix on EVERY turn, and on a CPU box
      //     prefill dominates. This keeps the expensive part cacheable.
      const idx = messages.lastIndexOf(lastUser);
      messages[idx] = { ...lastUser, content: `${grounding.block}

${lastUser.content}` };
    }
    if (import.meta.env?.DEV) {
      const t = grounding.trace;
      console.info(`[ground] ${t.skipped ? `skipped: ${t.skipped}` : `${t.hitTitles.length} hit(s) — ${t.hitTitles.join(", ")}`} · ${t.candidates} candidate(s) · top ${t.topScore.toFixed(2)} · ${t.blockTokens} tok${t.error ? ` · ${t.error}` : ""}`);
    }

    // Fit BEFORE the first call, and again after every reinjection, so a fat tool result evicts old
    // history rather than the student's current question. The grounding block is charged to its own
    // slice so it does not silently eat the history allowance.
    let fit = fitMessages(messages, budget, { groundingUsed: grounding.trace.blockTokens });
    messages = fit.messages;
    let droppedTotal = fit.dropped;
    if (import.meta.env?.DEV) {
      console.info(`[budget] ${formatBudgetUsage(budget, fit.usage)}${fit.dropped ? ` · dropped ${fit.dropped}` : ""}`);
    }

    let streamedText = ""; // everything shown to the user this turn = what we persist
    const toolCalls: TutorTurnResult["toolCalls"] = [];
    let usedKnowledgeUpdate = false;
    let endedNaturally = false; // the model gave a closing answer without calling a tool
    // Set when the provider reports the turn did not finish cleanly. "length" is included because
    // num_predict is now bounded by the budget's reserve slice, which makes hitting the output cap a
    // reachable outcome rather than a theoretical one.
    // Assigned inline rather than through a helper: TypeScript's control-flow analysis cannot see
    // writes made through a closure, so routing these through one narrows `interrupted` to null at
    // every later read and silently disables the checks below.
    let interrupted: "aborted" | "stalled" | "length" | null = null;

    for (let iteration = 0; ; iteration++) {
      if (shouldContinue(iteration, ctx).stop) break;

      let iterationText = ""; // text emitted before any tool call in THIS model turn
      const pendingCalls: Array<{ id: string; name: string; args: unknown }> = [];
      for await (const ev of callLLMTurn(messages, turn.config, { tools: toolDefs, tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") { iterationText += ev.delta; streamedText += ev.delta; turn.onText(ev.delta); }
        else if (ev.type === "tool_call") {
          // Namespace the id with the iteration. Ollama restarts its counter on each generator, so
          // iteration 1 and 2 both emit "call_0" — and the chat surface keys tool chips by id, so the
          // second call silently ERASED the first one's card.
          pendingCalls.push({ id: `${iteration}:${ev.id}`, name: ev.name, args: ev.args });
        }
        else if (ev.type === "done") {
          if (ev.finishReason === "aborted") interrupted = "aborted";
          else if (ev.finishReason === "stalled") interrupted = "stalled";
          else if (ev.finishReason === "length") interrupted = "length";
        }
      }

      // A hard interruption (Stop, or a stalled stream) ends the turn immediately. "length" does NOT:
      // the model may have emitted valid tool calls before running out of room, and dropping them
      // would lose work AND skip the forced final answer below, leaving the student with nothing.
      if (interrupted && interrupted !== "length") break;
      if (pendingCalls.length === 0) { endedNaturally = true; break; }

      // Record the assistant's tool-call turn, then dispatch each call and reinject its result.
      messages.push({
        role: "assistant",
        content: iterationText,
        tool_calls: pendingCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      for (const call of pendingCalls) {
        if (ctx.abort.aborted) { interrupted = "aborted"; break; }
        // eslint-disable-next-line no-await-in-loop -- tools run sequentially by design
        const result = await dispatchToolCall(call, ctx, turn.onToolEvent);
        toolCalls.push({ name: call.name, args: call.args, ok: result.ok });
        if (call.name === KNOWLEDGE_UPDATE_TOOL && result.ok) usedKnowledgeUpdate = true;
        // Cap what goes back into context. The model sees a visible truncation marker rather than a
        // silently shortened result it would otherwise answer from with false confidence.
        const payload = result.ok
          ? (result.modelText ?? JSON.stringify(result.value ?? {}))
          : `ERROR: ${result.error}`;
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: capText(payload, toolResultCap),
        });
      }
      if (ctx.abort.aborted) interrupted = interrupted ?? "aborted";
      if (interrupted && interrupted !== "length") break;

      fit = fitMessages(messages, budget);
      messages = fit.messages;
      droppedTotal += fit.dropped;
      if (import.meta.env?.DEV) {
        console.info(`[budget] after tools · ${formatBudgetUsage(budget, fit.usage)}${fit.dropped ? ` · dropped ${fit.dropped}` : ""}`);
      }
    }

    // If the loop ended on the iteration cap (not a natural closing answer, not an interruption),
    // force one final NO-tools call so the user always gets a reply, using the tool results already
    // in `messages`.
    const hardStopped = interrupted === "aborted" || interrupted === "stalled";
    if (!endedNaturally && !hardStopped && !ctx.abort.aborted) {
      for await (const ev of callLLMTurn(messages, turn.config, { tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") { streamedText += ev.delta; turn.onText(ev.delta); }
        else if (ev.type === "done") {
          if (ev.finishReason === "aborted") interrupted = "aborted";
          else if (ev.finishReason === "stalled") interrupted = "stalled";
          else if (ev.finishReason === "length") interrupted = "length";
        }
      }
    }

    // The abort flag is authoritative. `interrupted` can miss a Stop that lands during or after the
    // final tool dispatch — the loop then exits via shouldContinue, which discards its own reason —
    // and the turn would report "max_iterations", which the caller does not treat as partial. The
    // fragment would then be persisted unmarked and reflected into the course knowledge files.
    const stopReason: TutorTurnResult["stopReason"] =
      interrupted ?? (ctx.abort.aborted ? "aborted" : endedNaturally ? "complete" : "max_iterations");

    // Which retrieved passages did the answer DEMONSTRABLY reuse? Computed by n-gram overlap, never
    // by asking the model. This is what drives the citation chip, so a chip cannot be fabricated —
    // and an empty result against non-empty hits is the honest "answered from general knowledge"
    // case the UI is required to show rather than quietly drop.
    const usedHits = groundedIn(streamedText, grounding.hits);

    return {
      text: streamedText,
      toolCalls,
      usedKnowledgeUpdate,
      stopReason,
      usage: { contextTokens: budget.total, promptTokens: fit.usage.total, droppedMessages: droppedTotal },
      grounding,
      usedHits,
    };
  }
}

export const tutorEngine = new TutorEngine();
