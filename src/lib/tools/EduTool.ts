// The EduTool contract — single source of truth for every tool the tutor can call.
// Direct descendant of Claude Code's Tool.ts (docs/ARCHITECTURE.md). Schemas are zod
// (the chosen source of truth); the kernel converts inputSchema → JSON Schema via the dsl
// layer when it builds provider payloads.

import type { z } from "zod";
import type { ReactNode } from "react";
import type { LLMConfig, ModelTier, Syllabus } from "../../types";
import type { Skill } from "../dsl/skill";

// Permission mode for a turn. "exam" hard-denies model help during promotion tests;
// "bypass" is the escape hatch. Wired to the permission layer in Phase 2 (V2 §7).
export type PermissionMode = "default" | "study" | "exam" | "bypass";

// A single choice offered by ask_user.question. `label` is shown on the button,
// `value` is fed back to the model as the tool result.
export interface AskChoice {
  label: string;
  value: string;
}

// Kernel-mediated UI round-trip. The kernel injects this so a tool (ask_user.question)
// can suspend the turn awaiting a user selection, then resume with their choice. It is a
// Promise the UI resolves on click — NOT direct UI access, so the "tools never touch UI"
// discipline holds.
export type AskUserFn = (question: string, choices: AskChoice[]) => Promise<string>;

// Everything a tool needs about the turn it runs in. Tools never reach into the UI or the
// provider layer — they get this and nothing more.
export interface ToolContext {
  courseId: string;
  level: number;
  syllabus: Syllabus | null;
  modelTier: ModelTier;
  // The context window this turn runs in, in tokens — min(the model's maximum, the user's setting),
  // resolved by the caller from detectModelProfile. The kernel derives its whole budget from this.
  // Absent in older/headless callers, which fall back to budget.ts's DEFAULT_CONTEXT_TOKENS. (#86)
  contextTokens?: number;
  permissionMode: PermissionMode;
  // The active LLM config — tools that make their own model calls (knowledge reflection,
  // quiz authoring) read it here rather than re-fetching it. (Phase 1 addition.)
  config: LLMConfig;
  abort: AbortSignal;
  // Present only when the turn can round-trip to the user (chat). Absent in headless
  // contexts (eval); ask_user.question requires it. (Phase 1 addition.)
  askUser?: AskUserFn;
  // The skill driving this turn, selected via the chat mode bar (Phase 2). selectTools exposes only
  // this skill's tools_required, and the <skill_bundle> layer injects its rules. Absent in legacy /
  // headless callers (then selectTools falls back to all permitted tools).
  activeSkill?: Skill | null;
  // The domain skill for the course's subject — math-tutor / code-tutor (Phase 4a), resolved
  // code-routed from course.topic. Orthogonal to activeSkill (the mode): selectTools exposes the
  // UNION of both skills' tools_required, so e.g. a math course exposes math.render under any mode.
  // Absent for non-domain courses / headless callers.
  domainSkill?: Skill | null;
  // Permission round-trip for "ask" tools (Phase 2, V2 §7): the kernel calls this before running a
  // tool whose permission decision is "ask" and runs it only on `true`. Mirrors askUser; absent in
  // headless contexts (where "ask" then proceeds so eval tool goldens still exercise).
  confirmTool?: (toolName: string, summary: string) => Promise<boolean>;
}

// Tools are generators so long-running work (web fetch, quiz authoring, notebook indexing)
// can stream progress into the chat surface — same pattern Claude Code uses for Bash/WebSearch.
export type ToolEvent<O> =
  | { kind: "progress"; message: string }
  | { kind: "result"; value: O }
  | { kind: "error"; error: string };

export interface EduTool<Input = unknown, Output = unknown> {
  name: string;                    // "notebook.search"
  description: string;             // what the model sees
  inputSchema: z.ZodType<Input>;   // validation + provider-native enforcement (via dsl→JSON Schema)
  outputSchema?: z.ZodType<Output>;// structured render

  // Semantic checks the schema can't express (uniqueness, completeness). Empty = valid;
  // non-empty triggers repair-retry — same contract as callLLMStructured.opts.validate.
  validateOutput?: (out: Output) => string[];

  isReadOnly: boolean;             // controls auto-approve
  isDestructive?: boolean;         // forces explicit confirm
  isConcurrencySafe: boolean;      // parallelizable within a turn
  isEnabled: (ctx: ToolContext) => boolean | Promise<boolean>;

  call(input: Input, ctx: ToolContext): AsyncGenerator<ToolEvent<Output>>;

  // Optional: how the tool result renders inline in the chat surface.
  renderResult?: (output: Output) => ReactNode;

  // Optional: how the result is serialized INTO THE MODEL'S CONTEXT. Defaults to JSON.stringify.
  //
  // These are two different audiences and they want different things. The UI wants the full object
  // (ids to deep-link with, scores to rank by). The model wants prose it can answer from — every id
  // and float it cannot act on is window spent on punctuation. Splitting them lets a tool serve both
  // without the kernel special-casing any tool by name.
  toModelText?: (output: Output) => string;
}

// Ergonomic constructor: infers `Input` from the zod inputSchema so a tool author declares
// the schema exactly once (the payoff of choosing zod as the source of truth). `isEnabled`
// defaults to always-on. Output is an explicit generic — annotate the `call` return to set it.
export function defineTool<S extends z.ZodType, Output = void>(
  tool: Omit<EduTool<z.infer<S>, Output>, "inputSchema" | "isEnabled"> & {
    inputSchema: S;
    isEnabled?: (ctx: ToolContext) => boolean | Promise<boolean>;
  },
): EduTool<z.infer<S>, Output> {
  return { isEnabled: () => true, ...tool } as EduTool<z.infer<S>, Output>;
}
