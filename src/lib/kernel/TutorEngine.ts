// TutorEngine — the kernel that owns one tutoring turn (V2_ARCHITECTURE.md §4).
//
// Phase 0 skeleton: a single streamed completion, NO tool loop. This is the seam ChatTab
// will eventually call instead of streamChat directly. Phase 1 wraps this same call with
// tool dispatch, stop hooks, a per-turn token budget, and abort plumbing. Kept intentionally
// thin so wiring ChatTab to it in Phase 1 is a no-behavior-change swap.

import { callLLMStreaming } from "../llm";
import type { LLMConfig } from "../../types";

export interface TutorTurn {
  messages: Array<{ role: string; content: string }>;
  config: LLMConfig;
  onText: (chunk: string) => void;
}

export interface TutorTurnResult {
  text: string;
}

export class TutorEngine {
  // One turn. Today: stream tokens through onText, return the full text.
  // TODO(Phase 1): accept ToolContext; interleave tool_call → toolDispatch → reinject;
  //                shouldContinue() stop hooks; tokenBudget; AbortSignal wiring.
  async run(turn: TutorTurn): Promise<TutorTurnResult> {
    const text = await callLLMStreaming(turn.messages, turn.config, turn.onText);
    return { text };
  }
}

export const tutorEngine = new TutorEngine();
