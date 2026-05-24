// Public surface of the kernel.
export { TutorEngine, tutorEngine } from "./TutorEngine";
export type { TutorTurn, TutorTurnResult } from "./TutorEngine";
export { assembleSystemPrompt, toolsLayer, skillBundleLayer } from "./systemPrompt";
export type { SystemPromptInput } from "./systemPrompt";
export { dispatchToolCall, selectTools, buildProviderToolDefs } from "./toolDispatch";
export type { ToolUIEvent, ToolDispatchResult } from "./toolDispatch";
export { MAX_TURN_ITERATIONS } from "./stopHooks";
