// Tool dispatch — maps a model's tool_call → registry → EduTool.call generator → result,
// surfacing UI events along the way (V2_ARCHITECTURE.md §4). The kernel's turn loop reinjects
// the returned result (or error string) into the next model turn.
//
// Argument repair follows the same discipline as callLLMStructured: validate with the tool's
// zod inputSchema; on failure, return a structured error that the model sees as the tool result
// and self-corrects on the next iteration (bounded by the turn's iteration cap) — the agentic
// loop replaces nested retry logic.

import type { EduTool, ToolContext } from "../tools/EduTool";
import { toolRegistry } from "../tools/registry";
import { toProviderJsonSchema } from "../dsl/jsonSchema";
import { evaluatePermission } from "../permissions/evaluate";
import { loadPermissionRules } from "../permissions/store";
import type { ProviderToolDef } from "../llm";

// What the chat surface renders for an in-flight / finished tool call: a progress chip
// that becomes a result (or error) card. Identity is the tool_call id.
export type ToolUIEvent =
  | { kind: "start"; id: string; name: string }
  | { kind: "progress"; id: string; name: string; message: string }
  | { kind: "result"; id: string; name: string; value: unknown }
  | { kind: "error"; id: string; name: string; error: string };

export interface ToolDispatchResult {
  name: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

// Convert enabled EduTools → provider-ready tool defs (zod inputSchema → JSON Schema). This is
// the single bridge between the tool layer (zod) and the provider layer (JSON Schema).
export function buildProviderToolDefs(tools: EduTool[]): ProviderToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toProviderJsonSchema(t.inputSchema),
  }));
}

// The tools offered this turn (V2 §6.1 skill gating + §7 permissions). Pipeline:
//   isEnabled (registry) → permission "deny" filter → active-skill tools_required filter.
// When a skill is active, only its tools_required are exposed — e.g. plain "Explain"
// (tools_required: []) offers no action tools, which also curbs the floor model's stray tool
// calls. No active skill → all permitted tools (defensive back-compat; ChatTab + eval always set it).
export async function selectTools(ctx: ToolContext): Promise<EduTool[]> {
  const enabled = await toolRegistry.list(ctx);
  const rules = await loadPermissionRules();
  const permitted = enabled.filter((t) => evaluatePermission(t, ctx.permissionMode, rules) !== "deny");
  if (!ctx.activeSkill) return permitted;
  const allowed = new Set(ctx.activeSkill.tools_required);
  return permitted.filter((t) => allowed.has(t.name));
}

export async function dispatchToolCall(
  call: { id: string; name: string; args: unknown },
  ctx: ToolContext,
  onUIEvent?: (ev: ToolUIEvent) => void,
): Promise<ToolDispatchResult> {
  const tool = toolRegistry.get(call.name);
  if (!tool) {
    const error = `Unknown tool "${call.name}". Available tools: ${toolRegistry.all().map((t) => t.name).join(", ") || "(none)"}.`;
    onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
    return { name: call.name, ok: false, error };
  }

  // Validate args with the tool's zod schema. On failure, hand the model a precise error so it
  // re-calls correctly next iteration (no nested retry here — the turn loop is the retry).
  const parsed = tool.inputSchema.safeParse(call.args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    const error = `Invalid arguments for ${call.name}: ${issues}. Call it again with arguments that match the schema.`;
    onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
    return { name: call.name, ok: false, error };
  }

  // Permission gate (V2 §7). "deny" is already filtered out of selectTools, but a tool can still be
  // dispatched outside selection (e.g. a hallucinated call), so re-check here. "ask" requires a user
  // confirm when the turn can round-trip (ctx.confirmTool); headless contexts (eval) proceed.
  const rules = await loadPermissionRules();
  const decision = evaluatePermission(tool, ctx.permissionMode, rules);
  if (decision === "deny") {
    const error = `${call.name} is not permitted in ${ctx.permissionMode} mode.`;
    onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
    return { name: call.name, ok: false, error };
  }
  if (decision === "ask" && ctx.confirmTool) {
    const approved = await ctx.confirmTool(call.name, tool.description);
    if (!approved) {
      const error = `The student declined to let ${call.name} run.`;
      onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
      return { name: call.name, ok: false, error };
    }
  }

  onUIEvent?.({ kind: "start", id: call.id, name: call.name });
  try {
    let value: unknown;
    for await (const ev of tool.call(parsed.data, ctx)) {
      if (ev.kind === "progress") onUIEvent?.({ kind: "progress", id: call.id, name: call.name, message: ev.message });
      else if (ev.kind === "result") value = ev.value;
      else if (ev.kind === "error") {
        onUIEvent?.({ kind: "error", id: call.id, name: call.name, error: ev.error });
        return { name: call.name, ok: false, error: ev.error };
      }
    }

    // Optional semantic output check (uniqueness/completeness the schema can't express).
    if (tool.validateOutput && value !== undefined) {
      const issues = tool.validateOutput(value);
      if (issues.length) {
        const error = `${call.name} produced invalid output: ${issues.join("; ")}.`;
        onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
        return { name: call.name, ok: false, error };
      }
    }

    onUIEvent?.({ kind: "result", id: call.id, name: call.name, value });
    return { name: call.name, ok: true, value };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    onUIEvent?.({ kind: "error", id: call.id, name: call.name, error });
    return { name: call.name, ok: false, error };
  }
}
