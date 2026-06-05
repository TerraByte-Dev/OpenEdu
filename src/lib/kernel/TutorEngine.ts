// TutorEngine — the kernel that owns one tutoring turn (docs/ARCHITECTURE.md).
//
// The turn loop: assemble messages → select enabled tools → stream a provider turn →
// route text to onText and tool_calls to dispatch → reinject tool results → repeat until
// the model answers without calling a tool (or the iteration cap trips). A turn that
// offers no tools and uses no tool is byte-identical to the v1 streamed chat — that's the
// "plain chat looks identical" guarantee.
//
// The kernel is intentionally free of DB / React concerns. It returns the final text plus a
// summary of what happened; the caller (ChatTab) persists the message and runs the post-turn
// knowledge reflection — gated by `usedKnowledgeUpdate` so it never double-writes with the
// knowledge.update_map tool.

import { callLLMTurn, type NeutralMessage } from "../llm";
import type { LLMConfig } from "../../types";
import type { ToolContext } from "../tools/EduTool";
import { selectTools, buildProviderToolDefs, dispatchToolCall, type ToolUIEvent } from "./toolDispatch";
import { shouldContinue } from "./stopHooks";
import { toolsLayer } from "./systemPrompt";

const KNOWLEDGE_UPDATE_TOOL = "knowledge.update_map";

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
}

export class TutorEngine {
  async run(turn: TutorTurn, ctx: ToolContext): Promise<TutorTurnResult> {
    const messages: NeutralMessage[] = turn.messages.map((m) => ({
      role: m.role as NeutralMessage["role"],
      content: m.content,
    }));

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

    let streamedText = ""; // everything shown to the user this turn = what we persist
    const toolCalls: TutorTurnResult["toolCalls"] = [];
    let usedKnowledgeUpdate = false;
    let endedNaturally = false; // the model gave a closing answer without calling a tool

    for (let iteration = 0; ; iteration++) {
      if (shouldContinue(iteration, ctx).stop) break;

      let iterationText = ""; // text emitted before any tool call in THIS model turn
      const pendingCalls: Array<{ id: string; name: string; args: unknown }> = [];
      for await (const ev of callLLMTurn(messages, turn.config, { tools: toolDefs, tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") { iterationText += ev.delta; streamedText += ev.delta; turn.onText(ev.delta); }
        else if (ev.type === "tool_call") pendingCalls.push({ id: ev.id, name: ev.name, args: ev.args });
      }

      if (pendingCalls.length === 0) { endedNaturally = true; break; }

      // Record the assistant's tool-call turn, then dispatch each call and reinject its result.
      messages.push({
        role: "assistant",
        content: iterationText,
        tool_calls: pendingCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      for (const call of pendingCalls) {
        if (ctx.abort.aborted) break;
        const result = await dispatchToolCall(call, ctx, turn.onToolEvent);
        toolCalls.push({ name: call.name, args: call.args, ok: result.ok });
        if (call.name === KNOWLEDGE_UPDATE_TOOL && result.ok) usedKnowledgeUpdate = true;
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: result.ok ? JSON.stringify(result.value ?? {}) : `ERROR: ${result.error}`,
        });
      }
    }

    // If the loop ended on the iteration cap (not a natural closing answer), force one final
    // NO-tools call so the user always gets a reply, using the tool results already in `messages`.
    if (!endedNaturally && !ctx.abort.aborted) {
      for await (const ev of callLLMTurn(messages, turn.config, { tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") { streamedText += ev.delta; turn.onText(ev.delta); }
      }
    }

    return { text: streamedText, toolCalls, usedKnowledgeUpdate };
  }
}

export const tutorEngine = new TutorEngine();
