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
}

export interface TutorTurnResult {
  text: string;
  toolCalls: Array<{ name: string; args: unknown; ok: boolean }>;
  // True if knowledge.update_map ran successfully this turn — the caller skips its post-turn
  // auto-reflection so there's exactly one writer to the knowledge files.
  usedKnowledgeUpdate: boolean;
  // Why the turn ended. "stalled" (the stream went silent) and "aborted" (the student pressed Stop)
  // both mean `text` is a FRAGMENT — the caller must not persist it as a finished answer. Before #86
  // the done event was dropped entirely, so an aborted stream looked like a natural ending and a
  // truncated half-sentence was written to the database as the tutor's reply.
  stopReason: "complete" | "aborted" | "stalled" | "max_iterations";
  // Budget telemetry for the dev readout / diagnostics.
  usage: { contextTokens: number; promptTokens: number; droppedMessages: number };
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

    // Fit BEFORE the first call, and again after every reinjection, so a fat tool result evicts old
    // history rather than the student's current question.
    let fit = fitMessages(messages, budget);
    messages = fit.messages;
    let droppedTotal = fit.dropped;
    if (import.meta.env?.DEV) {
      console.info(`[budget] ${formatBudgetUsage(budget, fit.usage)}${fit.dropped ? ` · dropped ${fit.dropped}` : ""}`);
    }

    let streamedText = ""; // everything shown to the user this turn = what we persist
    const toolCalls: TutorTurnResult["toolCalls"] = [];
    let usedKnowledgeUpdate = false;
    let endedNaturally = false; // the model gave a closing answer without calling a tool
    let interrupted: "aborted" | "stalled" | null = null;

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
        }
      }

      if (interrupted) break;
      if (pendingCalls.length === 0) { endedNaturally = true; break; }

      // Record the assistant's tool-call turn, then dispatch each call and reinject its result.
      messages.push({
        role: "assistant",
        content: iterationText,
        tool_calls: pendingCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      for (const call of pendingCalls) {
        if (ctx.abort.aborted) { interrupted = "aborted"; break; }
        const result = await dispatchToolCall(call, ctx, turn.onToolEvent);
        toolCalls.push({ name: call.name, args: call.args, ok: result.ok });
        if (call.name === KNOWLEDGE_UPDATE_TOOL && result.ok) usedKnowledgeUpdate = true;
        // Cap what goes back into context. The model sees a visible truncation marker rather than a
        // silently shortened result it would otherwise answer from with false confidence.
        const payload = result.ok ? JSON.stringify(result.value ?? {}) : `ERROR: ${result.error}`;
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: capText(payload, toolResultCap),
        });
      }
      if (interrupted) break;

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
    if (!endedNaturally && !interrupted && !ctx.abort.aborted) {
      for await (const ev of callLLMTurn(messages, turn.config, { tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") { streamedText += ev.delta; turn.onText(ev.delta); }
        else if (ev.type === "done") {
          if (ev.finishReason === "aborted") interrupted = "aborted";
          else if (ev.finishReason === "stalled") interrupted = "stalled";
        }
      }
    }

    const stopReason: TutorTurnResult["stopReason"] =
      interrupted ?? (endedNaturally ? "complete" : "max_iterations");

    return {
      text: streamedText,
      toolCalls,
      usedKnowledgeUpdate,
      stopReason,
      usage: { contextTokens: budget.total, promptTokens: fit.usage.total, droppedMessages: droppedTotal },
    };
  }
}

export const tutorEngine = new TutorEngine();
