// Public surface of the kernel.
export { TutorEngine, tutorEngine } from "./TutorEngine";
export type { TutorTurn, TutorTurnResult } from "./TutorEngine";
export { assembleSystemPrompt, toolsLayer, skillBundleLayer, personaIdentityLayer } from "./systemPrompt";
export type { SystemPromptInput } from "./systemPrompt";
export { dispatchToolCall, selectTools, buildProviderToolDefs } from "./toolDispatch";
export type { ToolUIEvent, ToolDispatchResult } from "./toolDispatch";
export { MAX_TURN_ITERATIONS } from "./stopHooks";
export { ground, groundedIn, shouldRetrieve, selectHits, formatGroundingBlock, EMPTY_GROUNDING, type Grounding, type GroundingHit, type RetrievalMode } from "./ground";
export { suggestFollowUps, endsWithQuestion, hasTriedOpenQuestion, SHOW_ANSWER_MESSAGE, type Suggestion } from "./suggestions";
export { persistedReply } from "./persistedReply";
export { citationNote, quotedChipLabel, QUOTED_CHIP_TOOLTIP, type CitationNote } from "./citation";
export { OUTPUT_RULES, outputRulesLayer, WORKED_ANSWER_RULES, isWorkedAnswerTurn, turnSystemPrompt } from "./outputRules";
export { FIRST_TURN_HOLD_NOTE, posesNewProblem } from "./attemptFirst";
export { classifyTurn, classifyMessage, posesProblem, turnNoteFor, withTurnNote, TYPED_PROBLEM_HOLD_NOTE, FACT_LOOKUP_NOTE, type TurnKind } from "./turnKind";
