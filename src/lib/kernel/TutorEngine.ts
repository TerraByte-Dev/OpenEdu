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

import { callLLMTurn, log, OllamaToolCallParseError, type NeutralMessage, type ProviderToolDef } from "../llm";
import type { LLMConfig, Syllabus } from "../../types";
import { getSyllabus } from "../db";
import type { ToolContext } from "../tools/EduTool";
import { selectTools, buildProviderToolDefs, dispatchToolCall, declinedError, type ToolUIEvent, type ToolDispatchResult } from "./toolDispatch";
import { toolRegistry } from "../tools/registry";
import { evaluatePermission } from "../permissions/evaluate";
import { loadPermissionRules } from "../permissions/store";
import { shouldContinue } from "./stopHooks";
import { toolsLayer } from "./systemPrompt";
import { turnSystemPrompt, WORKED_ANSWER_RULES } from "./outputRules";
import { isFirstTurnHold, withFirstTurnHold } from "./attemptFirst";
import { isCheckBeforePraiseTurn, withCheckBeforePraise } from "./checkBeforePraise";
import { askedWord, lookupDictionary, withDictionaryNote, type DictionaryShown } from "./defineWord";
import { arithmeticFactTurn, withArithmeticFactNote, type ArithmeticFact } from "./arithmeticFact";
import { lookupWord } from "../dictionary";
import { budgetFor, fitMessages, capText, formatBudgetUsage, DEFAULT_CONTEXT_TOKENS, type Budget } from "./budget";
import { ground, groundedIn, shouldRetrieve, EMPTY_GROUNDING, type Grounding, type RetrievalMode } from "./ground";
import { shouldGloss, glossQuestion, type GlossResult } from "./gloss";
import { ReplyTextFilter } from "./textToolCalls";
import { MIXED_UP_REPLY, AFTER_ANSWER_REPLY } from "../plain-language";
import { onlyAnnouncesLookup } from "./lookupAnnouncement";
import { choicesInReply, type ReplyChoices } from "./replyChoices";
import { repairAskCard, answeredCard, askedCard, type AskCard } from "./askCard";
import type { QuestionResult } from "../tools/ask_user/QuestionTool";
import { asksForFlashcard, cardFromRequest, withFlashcardNote, FLASHCARD_TOOL, type Card } from "./flashcardRequest";
import { assessPickerCard, checkedSubtopic } from "./assessPicker";
import { isAssessAnswerTurn, inMasteryCheck, asksForMasteryCheck, checkAnswer, withAnswerCheckNote, answerCheckNote, readsAsAnswer, nonAnswerReply, checkedMessage, hintAnswerBack, TrailingQuestionHold, type AnswerCheck } from "./answerCheck";
import { ReplyClaimFilter, VERDICT_FALLBACK } from "./replyClaims";
import { showsPicture, withoutPictureClaims } from "./pictureClaims";
import { drawnCard } from "./drawnCards";
import { disclosureReply, isHarmTopicQuestion, isSafetyDisclosure } from "../child-safety";
import { gradeBand, type Grade } from "../grade";

const KNOWLEDGE_UPDATE_TOOL = "knowledge.update_map";
const ASK_USER_TOOL = "ask_user.question";
const MARK_MASTERED_TOOL = "progress.mark_mastered";
/** What the model is told when it tries to mark mastered on an answer code did not find correct. */
export const MASTERY_REFUSED =
  "Not saved: the app checked the student's answer and did not find it correct, so this subtopic can't be marked mastered now.";
/** What the model is told when it tries to mark mastered on a check's answer turn that the check gave no verdict
 *  (the tutor's message asked nothing with one right answer, or the child's message was a meaning question). */
export const MASTERY_REFUSED_UNCHECKED =
  "Not saved: the app did not check an answer on this turn, so this subtopic can't be marked mastered now.";
/** What the model is told when it tries to mark mastered on a turn whose answer was to a hint's own question
 *  (AnswerCheck.on): right, but the check's question is still open, so nothing that turn counts toward mastery. */
export const MASTERY_REFUSED_HINT =
  "Not saved: the student answered the hint's question, not the check's question, so this subtopic can't be marked mastered now. The check's question is still open.";
/** What the model is told when it tries to mark mastered on a turn whose newest message is a safety disclosure. */
export const MASTERY_REFUSED_DISCLOSURE =
  "Not saved: the student's newest message is not an answer, so nothing can be marked mastered on this turn.";
/** The tools that keep what a turn said: the course's knowledge files, the notebook, a flashcard. */
const KEEPS_WORDS = new Set([KNOWLEDGE_UPDATE_TOOL, "notebook.ingest", FLASHCARD_TOOL]);
/** What the model is told when it calls one of KEEPS_WORDS on a turn in a thread with a safety disclosure (keepsNothing). */
export const NOT_SAVED_DISCLOSURE =
  "Not saved: nothing from this turn is kept in the student's knowledge files, notes or flashcards.";
/** What the model is told when the claim filter left nothing of an ask_user.question card to show. */
export const CARD_REFUSED =
  "Not shown: this question said something about the student's answer or mastery that the app's check does not show. Ask again without saying whether the answer is right, or that anything is mastered.";
// A call whose result the chat draws as the answer in the reply's place (ChatTab ToolActivity): the
// flashcard the app made because the student asked for one. Every other tool shows only a chip ("✓ Looked
// it up in the library"), which answers nothing, so a turn that ran only those and wrote nothing is a
// blank turn. A math.render or diagram.render drawing is not here: it is reply text (drawnCards.ts). Nor is
// the app's topic picker (assessPicker.ts): its question and the learner's answer are reply text (askCard.ts).
const showsAnswerCard = (c: { name: string; ok: boolean; byApp?: true }) => c.ok && !!c.byApp && c.name === FLASHCARD_TOOL;
const marksMastered = (args: unknown) => !!args && typeof args === "object" && (args as { status?: unknown }).status === "mastered";
// The id of the flashcard.create call the app makes itself (flashcard stage). It never reaches a
// provider: the model sees a note, not a tool call, so no tool_use id rules apply.
const APP_FLASHCARD_CALL_ID = "app_flashcard";
// The id of the ask_user.question call the app makes itself (the topic picker, assessPicker.ts). The model
// reads it back as its own call, so it keeps to the ids every provider accepts.
const APP_PICKER_CALL_ID = "app_picker";
// The id of the progress.mark_mastered call the app makes itself after a correct check answer (appMark). It
// runs after the reply and never reaches a provider.
const APP_MARK_CALL_ID = "app_mark";

/**
 * The "mastered" mark code makes after the turn, or null for none (TerraTutor live tests 2026-11-19 parts 7
 * and 8 and 2026-11-20 part 9: gemma4:e2b, the default below 16 GB, never called progress.mark_mastered
 * after a check answer graded correct, 4 of 4 turns in part 9, so on the default model a check never moved
 * mastery; OpenEdu runs the same assess.md on the same default model). It is
 * the mark the model's call would save, under the gate that call passes (respond): the tool is offered
 * (assess mode, tools on, not denied), the newest message is not a safety disclosure, every answer checked
 * this turn is "correct". Stricter than that gate: a typed answer marks only when it is the learner's first
 * message since the check opened (`firstAttempt`). After any other message (a hint or help request, "I
 * don't know", a wrong answer) the tutor may have asked an easier question, and the answer is graded on
 * that one (review of the TerraTutor #266 port: "help", then "What is 4 + 4 + 4?" answered "12", marked
 * the check's skill). A turn graded only on cards marks only when its newest message opened the check (a
 * hint request answered with a card, in a caller that runs every turn in assess, does not).
 * Not when the model's own progress.mark_mastered call ran this turn, whatever its status, or the learner
 * said no to it on the "Is that okay?" card (`modelMarked`); a model call that failed (a wrong id) or was
 * refused does not count. Not on a turn that was stopped or ended at a card. The subtopic is the one code
 * knows the check is on, from what was shown before the graded answer (assessPicker.ts checkedSubtopic),
 * read with the saved syllabus (`load`, never ctx.syllabus, the course view's snapshot), and one already
 * mastered gets none. "partly", "incorrect", "unsure", an answer that answered nothing, any answer after
 * the first (so a second skill in the same check is left to the model's own call) and a closed check give
 * no mark.
 */
async function appMark(result: TutorTurnResult, conversation: ReadonlyArray<{ role: string; content: string }>, offered: ReadonlySet<string>, disclosureTurn: boolean, load: () => Promise<Syllabus | null>): Promise<{ subtopic_id: string; status: "mastered" } | null> {
  if (disclosureTurn || !offered.has(MARK_MASTERED_TOOL)) return null;
  if (result.stopReason === "aborted" || result.stopReason === "stalled" || result.cardMessage !== null) return null;
  const { beforeCard, modelMarked } = result.markInput ?? { beforeCard: null, modelMarked: false };
  if (modelMarked) return null;
  const checked = [result.answerCheck, ...result.cardChecks].filter((c): c is AnswerCheck => !!c);
  if (!checked.length || checked.some((c) => c.verdict !== "correct" || c.nonAnswer)) return null;
  if (result.answerCheck ? !firstAttempt(conversation) : !asksForMasteryCheck(conversation[conversation.length - 1]?.content ?? "")) return null;
  // A typed answer was graded on what came before the student's newest message, so a pick in this reply
  // (a "which one next?" card after it) says nothing about it; a card's answer, on what the reply showed
  // before that card.
  const syllabus = await load().catch(() => null);
  const sub = checkedSubtopic(conversation, result.answerCheck ? "" : beforeCard ?? "", syllabus);
  return sub && !sub.mastered ? { subtopic_id: sub.id, status: "mastered" } : null;
}

/** True when the learner's message before the newest is the request that opened the check: the newest is their first try. */
function firstAttempt(conversation: ReadonlyArray<{ role: string; content: string }>): boolean {
  for (let j = conversation.length - 2; j >= 0; j--) {
    if (conversation[j].role === "user") return asksForMasteryCheck(conversation[j].content);
  }
  return false;
}

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
  // "off" sends no dictionary note on this turn (defineWord.ts), so the define eval can run its paired
  // baseline at the same commit (EVAL_DICTIONARY=off). The asked word is still detected and reported.
  // Default "on"; the app never sets it.
  dictionary?: "on" | "off";
  // "off" sends no arithmetic-fact note on this turn (arithmeticFact.ts), so an eval can run its paired
  // baseline at the same commit. Default "on"; the app never sets it.
  arithmeticFacts?: "on" | "off";
  // "off" keeps the dictionary senses in stored order (lever 18 as shipped), so the define eval can run
  // lever 19's paired baseline at the same commit (EVAL_SENSE_RANK=off). Default "on"; the app never
  // sets it.
  senseRank?: "on" | "off";
  // "off" skips the flashcard stage (flashcardRequest.ts), so the tool goldens still measure whether
  // the model itself calls flashcard.create. Default "on"; the app never sets it.
  flashcardStage?: "on" | "off";
  // "off" skips the assess-mode answer check (answerCheck.ts) and its note, so an eval can run the
  // paired baseline. The reply filter for claims (replyClaims.ts) still runs. Default "on"; the app
  // never sets it.
  answerCheck?: "on" | "off";
  // The learner's grade (grade.ts), as ChatTab passes it to isSafetyDisclosure for the safety notice: a
  // strong pregnancy self-disclosure is a safety disclosure only with a K-12 grade set. Omitted or null =
  // not set. The kernel reads it to tell a safety disclosure from an answer (child-safety.ts), and to pick
  // the words of the fixed reply to a harm disclosure by grade band (child-safety.ts disclosureReply).
  grade?: Grade | null;
}

export interface TutorTurnResult {
  text: string;
  // `byApp` marks a call the app made itself rather than the model (the flashcard stage,
  // flashcardRequest.ts, the topic picker, assessPicker.ts, and the mark after a correct check answer,
  // appMark), so an eval can tell the model's tool choice from the app's. `fromText` marks a
  // call the model wrote as reply text and the kernel parsed (textToolCalls.ts) rather than a call the
  // provider returned.
  toolCalls: Array<{ name: string; args: unknown; ok: boolean; byApp?: true; fromText?: true }>;
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
  // True when the system prompt this turn sent ended, before the tools manifest, with
  // WORKED_ANSWER_RULES (lever L1). Read from the prompt itself, not from the gate, so the eval can
  // record what the model was actually told.
  workedAnswerRules: boolean;
  // True when this turn appended FIRST_TURN_HOLD_NOTE to the student's message (the first-turn
  // attempt-first hold, attemptFirst.ts), so the eval can record what the model was told.
  firstTurnHold: boolean;
  // The word the student's newest message asks the meaning of (defineWord.ts askedWord), whether or not
  // a note was sent; null when the message is not a meaning question.
  askedWord: string | null;
  // The dictionary entry and note this turn appended to the student's message, or null for none (not a
  // meaning question, the word not in the dictionary, a failed lookup, another note's turn, or "off").
  dictionaryNote: string | null;
  // The entry that note was built from, exactly the senses in it (defineWord.ts shownEntry), for the
  // chat's dictionary card; null whenever dictionaryNote is null. Not part of the request.
  dictionaryShown: DictionaryShown | null;
  // The arithmetic fact this turn's note gave the model (arithmeticFact.ts), or null for none (not a plain
  // arithmetic question, a mastery check, the tutor's own question, another note's turn, or "off").
  arithmeticFact: ArithmeticFact | null;
  // Set when Ollama could not parse a tool call the model wrote (OllamaToolCallParseError in llm.ts)
  // and the kernel answered the turn with one call without tools instead of failing it. `iteration`
  // is the model call that failed (0 = the first); `error` is Ollama's own error text. Null on every
  // other turn.
  toolCallRecovery: { iteration: number; error: string } | null;
  // Choices a completed reply wrote as a trailing numbered or lettered list instead of calling
  // ask_user.question (replyChoices.ts). The caller shows them as the same buttons ask_user shows.
  // Null when the turn called ask_user.question, did not complete, or offers no such list.
  replyChoices: ReplyChoices | null;
  // The assess-mode answer check (answerCheck.ts): the question, the key code used and the verdict the
  // reply was told. Null on a turn that is not an answer in a mastery check, or whose message asked
  // nothing with one right answer.
  answerCheck: AnswerCheck | null;
  // The same check on each answer the child gave to an ask_user.question card in a mastery check, in
  // order (cardTutorMessage below). A pick is the child's answer as much as a typed one is. Empty on
  // every other turn, and for a card whose question asks nothing with one right answer.
  cardChecks: AnswerCheck[];
  // Sentences the reply filter (replyClaims.ts) took out or trimmed: mastery claims with no mastery
  // saved, and claims against the answer check's verdict. As the model wrote them.
  removedClaims: Array<{ kind: "mastery" | "verdict"; text: string }>;
  // What the child typed into an ask_user.question card when it reads as a safety disclosure
  // (isSafetyDisclosure, with TutorTurn.grade). It is not taken as the card's answer: the turn ends at the
  // card with its question shown, and nothing is graded, echoed or sent to the model. The caller sends this
  // text as the student's own next message, so it gets exactly what a typed chat message gets: the safety
  // notice under it, the fixed disclosureReply (or the model under the safety rules in the system prompt for a
  // question about someone else or a pregnancy disclosure), no grading. Null on every other turn.
  cardMessage: string | null;
  // True when the student's newest message is a safety disclosure (isSafetyDisclosure, with
  // TutorTurn.grade), or any earlier student message in the thread the turn was sent (turnInDisclosedThread).
  // Nothing from the turn is kept: the kernel runs no flashcard stage and refuses
  // knowledge.update_map, notebook.ingest and flashcard.create (KEEPS_WORDS), and the caller runs no
  // knowledge reflection, which would put the learner's words in the course's knowledge files and so into
  // every later tutor prompt for that course. The model still reads the disclosure in its history after it
  // ("what should i do" next), so its reply on a later turn can repeat it.
  disclosure: boolean;
  // True when the turn's text is child-safety.ts disclosureReply: the newest message is a self-harm, suicide
  // or abuse disclosure and not a question about someone else (isHarmTopicQuestion), so the turn made no
  // model call, ran no tool and looked nothing up (ported from TerraTutor #246). The caller saves and reads
  // it like any reply, and offers nothing after it: no citation note, follow-up chips or reply choices.
  fixedReply: boolean;
  // For the mark code makes after a correct check answer (appMark), not for callers. `beforeCard`: what the
  // reply showed before the first card graded this turn (its question and the learner's answer), null when
  // none was. `modelMarked`: the model's progress.mark_mastered call ran this turn, or the learner said no
  // to it. Absent on a turn with no model call.
  markInput?: { beforeCard: string | null; modelMarked: boolean };
}

/**
 * A turn that failed after grounding ran. The message is the underlying error's, unchanged, so a
 * caller that shows `e.message` shows what it showed before; `grounding` is what retrieval found
 * before the failure, so the eval can tell a failed model call from an empty vault.
 */
export class TutorTurnError extends Error {
  readonly grounding: Grounding;
  readonly cause: unknown;
  constructor(cause: unknown, grounding: Grounding) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "TutorTurnError";
    this.cause = cause;
    this.grounding = grounding;
  }
}

// The result of a turn answered by child-safety.ts disclosureReply (TutorTurnResult.fixedReply): no model
// call, so nothing was sent, retrieved, checked or called, and nothing from the turn is kept (`disclosure`).
function fixedReplyResult(text: string, contextTokens: number): TutorTurnResult {
  return {
    text,
    toolCalls: [],
    usedKnowledgeUpdate: false,
    stopReason: "complete",
    usage: { contextTokens, promptTokens: 0, droppedMessages: 0 },
    grounding: EMPTY_GROUNDING,
    usedHits: [],
    workedAnswerRules: false,
    firstTurnHold: false,
    askedWord: null,
    dictionaryNote: null,
    dictionaryShown: null,
    arithmeticFact: null,
    toolCallRecovery: null,
    replyChoices: null,
    answerCheck: null,
    cardChecks: [],
    removedClaims: [],
    cardMessage: null,
    disclosure: true,
    fixedReply: true,
  };
}

// The verdict line on the reply to an answer to a hint's own question, when the model's reply showed nothing
// (it was only a question, which TrailingQuestionHold drops): VERDICT_FALLBACK's, without its question, as
// code asks the check's question right after it. An answer tagged `on: "hint"` is right, partly right or
// "unsure" (a hint question with no key), never "incorrect": that entry is only there to fill the record.
const HINT_LEAD: Record<AnswerCheck["verdict"], string> = {
  correct: VERDICT_FALLBACK.correct,
  partly: "That's partly right.",
  incorrect: "That's not right yet.",
  unsure: "Okay.",
};

/** A mastery check's answer that code found answers nothing: code's reply, no reply call (answerCheck.ts nonAnswerReply). */
function nonAnswerResult(contextTokens: number, text: string, answerCheck: AnswerCheck, grounding: Grounding, disclosure: boolean): TutorTurnResult {
  return { ...fixedReplyResult(text, contextTokens), grounding, answerCheck, disclosure, fixedReply: false };
}

// The system messages without the <tools> manifest the kernel appended (or inserted on its own).
function withoutManifest(messages: NeutralMessage[], manifest: string): NeutralMessage[] {
  const suffix = `\n\n${manifest}`;
  return messages
    .filter((m) => !(m.role === "system" && m.content === manifest))
    .map((m) => (m.role === "system" && m.content.endsWith(suffix) ? { ...m, content: m.content.slice(0, -suffix.length) } : m));
}

/** A tool call's id in the kernel: the provider's id, namespaced by iteration. Joined with "_", because
 *  Anthropic refuses a tool_use id outside [a-zA-Z0-9_-] (#262). */
export function kernelCallId(iteration: number, providerId: string): string {
  return `${iteration}_${providerId}`;
}

/**
 * What the answer check reads as the tutor's message when the child answers an ask_user.question card:
 * the reply's text before the card (it may set up the problem), the card's question, and its choices
 * as the child saw them, so the key can be one of them.
 */
export function cardTutorMessage(before: string, card: AskCard): string {
  const choices = (Array.isArray(card.choices) ? card.choices : []).map((c) => `- ${c.label}`).join("\n");
  return [before.trim(), card.question.trim(), choices ? `Choices:\n${choices}` : ""].filter(Boolean).join("\n\n");
}

/**
 * Whether any student message the turn was sent is a safety disclosure (isSafetyDisclosure, with the learner's
 * grade): the window is the thread as the caller sends it. ChatTab sends what getChatMessages loads, the open
 * thread's newest CHAT_HISTORY_LIMIT (200) messages, so past 200 the window is those 200: once the disclosure
 * scrolls out, a tutor reply that repeated it can still be in what the model reads, and keeping starts again.
 * A later turn in that thread keeps nothing either (TutorTurnResult.disclosure), since the model still reads
 * the disclosure and may repeat it. Only keeping is widened: the turn's reply, its answer check and its
 * dictionary note go by the newest message alone (ported from TerraTutor #238).
 */
export function turnInDisclosedThread(messages: ReadonlyArray<{ role: string; content: string }>, grade: Grade | null): boolean {
  return messages.some((m) => m.role === "user" && isSafetyDisclosure(m.content, grade));
}

export class TutorEngine {
  async run(turn: TutorTurn, ctx: ToolContext): Promise<TutorTurnResult> {
    // A self-harm, suicide or abuse disclosure in the newest message (isSafetyDisclosure with no grade: the
    // harm half alone) is answered by code: disclosureReply for the learner's grade band, with no model call,
    // no tools, no lookup and no card (ported from TerraTutor #246, whose click test found gemma4:e2b's own
    // words cold: "Please stop. I am very sorry..." and "I cannot help with that kind of question. Please tell
    // me if you have any questions about fractions."). The safety notice under the message is ChatTab's, as
    // before, and nothing from the turn is kept. A harm hit that is a question about someone else
    // (isHarmTopicQuestion: "why did romeo commit suicide?", "what does molest mean") keeps the model path
    // below, so schoolwork the list cannot tell from a disclosure still gets its answer, and so does a strong
    // self-disclosure of a pregnancy (with a K-12 grade set).
    const newestIn = turn.messages[turn.messages.length - 1];
    if (newestIn?.role === "user" && isSafetyDisclosure(newestIn.content) && !isHarmTopicQuestion(newestIn.content)) {
      const text = disclosureReply(gradeBand(turn.grade ?? null));
      turn.onText(text);
      return fixedReplyResult(text, budgetFor(ctx.contextTokens ?? DEFAULT_CONTEXT_TOKENS).total);
    }
    const messages: NeutralMessage[] = turn.messages.map((m) => ({
      role: m.role as NeutralMessage["role"],
      content: m.content,
    }));

    const budget: Budget = budgetFor(ctx.contextTokens ?? DEFAULT_CONTEXT_TOKENS);
    const toolResultCap = Math.floor(budget.grounding * TOOL_RESULT_BUDGET_FRACTION);

    // The worked-answer turn (lever L1): when the student's newest message is exactly the show-answer
    // chip's text and the chip was offered under the reply before it, this turn's output rules become
    // the worked-answer rules. Done here, before the tools manifest is appended, so every caller of
    // the kernel gets it and no caller can fork it. Any other turn's system prompt is untouched. See
    // outputRules.ts.
    const sysAt = messages.findIndex((m) => m.role === "system");
    if (sysAt >= 0) {
      const conversation = messages.filter((m) => m.role !== "system");
      messages[sysAt] = { ...messages[sysAt], content: turnSystemPrompt(messages[sysAt].content, conversation) };
    }
    const workedAnswerRules = sysAt >= 0 && messages[sysAt].content.endsWith(WORKED_ANSWER_RULES);
    // The first-turn hold (attemptFirst.ts): decided here from the conversation as the caller sent it,
    // applied below after retrieval, so the query and the gloss see only what the student typed.
    const firstTurnHold = isFirstTurnHold(messages.filter((m) => m.role !== "system"));
    // The check-before-praise note (checkBeforePraise.ts): a try at the problem the tutor just worked
    // on. Decided and applied the same way as the hold; never on the same turn as it.
    const conversation = messages.filter((m) => m.role !== "system");
    const checkBeforePraiseTurn = isCheckBeforePraiseTurn(conversation);
    // The dictionary note (defineWord.ts): an explicit "what does X mean" in the student's newest
    // message, looked up in the bundled dictionary. Never on a hold or check-before-praise turn: those
    // notes govern a problem turn, and one note per turn keeps each lever's effect its own. Never on a
    // safety-disclosure turn (`disclosure`, below) either: "I want to die. what does suicide mean?" takes
    // the safety path, with no entry, example or "explain it" note beside it, and no dictionary card. The
    // lookup starts here and is awaited after retrieval; it never throws, and a miss leaves the turn unchanged.
    const newest = messages[messages.length - 1];
    const asked = newest?.role === "user" ? askedWord(newest.content) : null;
    const disclosure = newest?.role === "user" && isSafetyDisclosure(newest.content, turn.grade ?? null);
    // Nothing from the turn is kept (TutorTurnResult.disclosure): the newest message or an earlier one in the thread is a disclosure.
    const keepsNothing = disclosure || turnInDisclosedThread(turn.messages, turn.grade ?? null);
    const dictionaryLookup = asked && !disclosure && !firstTurnHold && !checkBeforePraiseTurn && turn.dictionary !== "off"
      ? lookupDictionary(asked.word, lookupWord, undefined, ctx.abort, turn.senseRank === "off" ? undefined : asked.context)
      : Promise.resolve(null);
    // The arithmetic-fact note (arithmeticFact.ts, ported from TerraTutor #250): the student's newest
    // message plainly asks one simple arithmetic fact ("what is 7 times 8?"), worked out exactly by code.
    // Not in a mastery check or on the tutor's own question (arithmeticFactTurn), and never beside another
    // note: a safety disclosure, the first-turn hold, check-before-praise, a meaning question, or the card
    // the app makes below (`arithmeticFact`, after the flashcard stage). Any other turn is sent as before.
    const asksFact = !disclosure && !firstTurnHold && !checkBeforePraiseTurn && !asked && turn.arithmeticFacts !== "off"
      ? arithmeticFactTurn(conversation, ctx.activeSkill?.name)
      : null;
    // The answer check (answerCheck.ts): the student's answer to the tutor's question in a mastery
    // check gets a verdict from code (a blind key, a code compare, a structured grading call) before
    // the reply is written. Started here, awaited after retrieval; it never throws. On a turn it gives a
    // verdict, its note replaces the check-before-praise note: the verdict is a fact, not a request to
    // check. Neither runs when the newest message is a safety disclosure (`disclosure`, the same check
    // ChatTab's notice makes): "this is too hard i wanna die" typed in a quiz is not a wrong answer, and
    // no note may send the child back to the work (CHILD_SAFETY_RULES).
    const answerTurn = !disclosure && turn.answerCheck !== "off" && isAssessAnswerTurn(conversation, ctx.activeSkill?.name);
    const checked = checkedMessage(conversation);
    const answerCheckRun = answerTurn && !firstTurnHold && !asked
      ? checkAnswer(checked.message, newest.content, turn.config, { tier: ctx.modelTier, signal: ctx.abort }, checked.hint)
      : Promise.resolve(null);

    let eduTools = await selectTools(ctx);

    // The flashcard stage (flashcardRequest.ts): a student who asks for a card gets one made by the
    // app, through flashcard.create's own dispatch (permissions, confirm card, chip), whatever the
    // mode. It does not run at all when the permission rules deny the tool. A chip shows while the
    // card call runs, so a slow model is not a blank screen. Once a card has been dispatched, the model
    // is not offered the tool again this turn, so it cannot make a second card. A failed card call
    // clears the chip and the turn goes on as before. Never on a safety-disclosure turn (`disclosure`):
    // "i wanna die. make me a flashcard for 7 x 8" takes the safety path only, with no card call, no card
    // made from the learner's words and no "it is saved" note sending them back to the work. Nor later in a
    // thread with a disclosure in it (`keepsNothing`): "my uncle touches me", then "make me a flashcard" gets no card.
    let appCard: { call: TutorTurnResult["toolCalls"][number]; saved: Card | null } | null = null;
    const cardTool = toolRegistry.get(FLASHCARD_TOOL);
    if (
      !keepsNothing && turn.flashcardStage !== "off" && cardTool && newest?.role === "user" && asksForFlashcard(newest.content) &&
      evaluatePermission(cardTool, ctx.permissionMode, await loadPermissionRules()) !== "deny"
    ) {
      turn.onToolEvent?.({ kind: "progress", id: APP_FLASHCARD_CALL_ID, name: FLASHCARD_TOOL, message: "making a flashcard…" });
      const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const card = await cardFromRequest(newest.content, lastReply, turn.config, { tier: ctx.modelTier, signal: ctx.abort });
      if (card && !ctx.abort.aborted) {
        const call = { id: APP_FLASHCARD_CALL_ID, name: FLASHCARD_TOOL, args: card };
        const result = await dispatchToolCall(call, ctx, turn.onToolEvent);
        appCard = { call: { name: FLASHCARD_TOOL, args: card, ok: result.ok, byApp: true }, saved: result.ok ? card : null };
        eduTools = eduTools.filter((t) => t.name !== FLASHCARD_TOOL);
      } else {
        // The chat hides an error chip, so this only takes the progress chip away.
        turn.onToolEvent?.({ kind: "error", id: APP_FLASHCARD_CALL_ID, name: FLASHCARD_TOOL, error: "no card was made" });
      }
    }
    const arithmeticFact = appCard ? null : asksFact;

    const offered = new Set(eduTools.map((t) => t.name));

    // The topic picker that opens a mastery check (assessPicker.ts): when the check starts and two or more
    // of the level's subtopics are not mastered, the app shows the ask_user.question card itself, in place
    // of the turn's first model call, instead of hoping the model calls it. Only where the model could
    // have: the tool is offered (assess mode, tools on, not denied by the permission rules) and the
    // caller can show a card. Never on a safety-disclosure turn (`disclosure`).
    const picker = !disclosure && ctx.askUser && offered.has(ASK_USER_TOOL) && newest?.role === "user"
      ? assessPickerCard(newest.content, ctx.activeSkill?.name, ctx.syllabus)
      : null;
    const appAsk = picker ? { id: APP_PICKER_CALL_ID, name: ASK_USER_TOOL, args: picker, byApp: true as const } : null;
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
    const retrieval = turn.retrieval ?? "always";

    // Lever L2 (gloss.ts): a question in a non-Latin script gets one short call that writes it in
    // English, and retrieval searches with both. The call continues this turn's own prefix (the
    // messages as fitted, the same tools, the same num_ctx) so Ollama neither reloads nor loses its
    // prefix cache. A question needsGloss rejects skips this block entirely, so its requests are the
    // pre-L2 ones; english-path.test.ts pins that byte for byte for its English questions. The check is
    // a heuristic, so some English text can still be glossed. Ollama only (shouldGloss): on a cloud
    // provider the call is unmeasured and paid.
    let gloss: GlossResult | null = null;
    if (lastUser && shouldRetrieve(lastUser.content, retrieval).retrieve && shouldGloss(lastUser.content, turn.config.provider)) {
      gloss = await glossQuestion(fitMessages(messages, budget).messages, lastUser.content, turn.config, {
        tools: toolDefs, tier: ctx.modelTier, signal: ctx.abort,
      });
    }

    const grounded = lastUser
      ? await ground(lastUser.content, ctx, budget, retrieval, gloss?.text)
      : EMPTY_GROUNDING;
    const grounding: Grounding = gloss ? { ...grounded, trace: { ...grounded.trace, gloss } } : grounded;

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
    if (firstTurnHold) {
      // After the grounding block and the student's text, so the note is the last thing the model
      // reads before it answers. The system prompt is untouched; see attemptFirst.ts.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withFirstTurnHold(messages[idx].content) };
    }
    const answerCheck = await answerCheckRun;
    if (answerCheck) {
      // Same place as the hold note: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withAnswerCheckNote(messages[idx].content, answerCheck) };
    } else if (checkBeforePraiseTurn && !disclosure) {
      // Same place as the hold note: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withCheckBeforePraise(messages[idx].content) };
    }
    const dictionary = await dictionaryLookup;
    const dictionaryNote = dictionary?.note ?? null;
    if (dictionaryNote) {
      // Same place as the other notes: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withDictionaryNote(messages[idx].content, dictionaryNote) };
    }
    if (arithmeticFact) {
      // Same place as the other notes: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withArithmeticFactNote(messages[idx].content, arithmeticFact) };
    }
    if (appCard) {
      // Same place as the other notes: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withFlashcardNote(messages[idx].content, appCard.saved) };
    }
    if (import.meta.env?.DEV) {
      const t = grounding.trace;
      console.info(`[ground] ${t.skipped ? `skipped: ${t.skipped}` : `${t.hitTitles.length} hit(s) — ${t.hitTitles.join(", ")}`} · ${t.candidates} candidate(s) · top ${t.topScore.toFixed(2)} · ${t.blockTokens} tok${t.error ? ` · ${t.error}` : ""}`);
    }

    if (answerCheck?.nonAnswer) {
      // Code found the answer answers nothing ("xyz", "?!"), so code writes the reply too, with no reply
      // call (ChatTab's post-turn reflection still runs): a model told "not correct" still added "That is close." (TerraTutor click test 2026-11-19 part 3).
      const result = nonAnswerResult(budget.total, nonAnswerReply(checked.message, answerCheck), answerCheck, grounding, keepsNothing);
      turn.onText(result.text);
      return result;
    }
    let result: TutorTurnResult;
    try {
      result = await this.respond(turn, ctx, { appCall: appCard?.call ?? null, appAsk, messages, budget, toolResultCap, toolDefs, offered, manifest, grounding, workedAnswerRules, firstTurnHold, askedWord: asked?.word ?? null, dictionaryNote, dictionaryShown: dictionary?.shown ?? null, arithmeticFact, answerCheck, hintBack: hintAnswerBack(checked.message, answerCheck), checkAnswers: !disclosure && turn.answerCheck !== "off", disclosureTurn: disclosure, keepsNothing, answerTurn, answered: newest?.content ?? "", masteryCheck: inMasteryCheck(conversation, ctx.activeSkill?.name) });
    } catch (e) {
      throw new TutorTurnError(e, grounding);
    }
    // A correct check answer the model did not mark: code makes the mark, through the tool's own dispatch
    // (the "Is that okay?" card where it is set to Ask, the chip), under the reply (appMark).
    const mark = ctx.abort.aborted ? null : await appMark(result, conversation, offered, disclosure, () => getSyllabus(ctx.courseId, ctx.level));
    if (mark) {
      const marked = await dispatchToolCall({ id: APP_MARK_CALL_ID, name: MARK_MASTERED_TOOL, args: mark }, ctx, turn.onToolEvent, offered);
      result = { ...result, toolCalls: [...result.toolCalls, { name: MARK_MASTERED_TOOL, args: mark, ok: marked.ok, byApp: true }] };
    }
    return result;
  }

  // The model loop, after grounding: everything that calls the model and can fail.
  private async respond(
    turn: TutorTurn,
    ctx: ToolContext,
    prepared: {
      appCall: TutorTurnResult["toolCalls"][number] | null;
      /** The app's topic picker (assessPicker.ts): run in place of the first model call. */
      appAsk: { id: string; name: string; args: AskCard; byApp: true } | null;
      messages: NeutralMessage[];
      budget: Budget;
      toolResultCap: number;
      toolDefs: ProviderToolDef[] | undefined;
      offered: Set<string>;
      manifest: string | null;
      grounding: Grounding;
      workedAnswerRules: boolean;
      firstTurnHold: boolean;
      askedWord: string | null;
      dictionaryNote: string | null;
      dictionaryShown: DictionaryShown | null;
      arithmeticFact: ArithmeticFact | null;
      answerCheck: AnswerCheck | null;
      /** The check's question again, shown after the reply when the answer was to a hint's own question
       *  (answerCheck.ts hintAnswerBack), else null. */
      hintBack: string | null;
      /** False when the caller turned the answer check off (TutorTurn.answerCheck), or the newest message is
       *  a safety disclosure: nothing on that turn is graded, a card's answer included. */
      checkAnswers: boolean;
      /** The newest message is a safety disclosure: a "mastered" mark on this turn is refused. */
      disclosureTurn: boolean;
      /** The newest message or an earlier one in the thread is a safety disclosure: KEEPS_WORDS are refused. */
      keepsNothing: boolean;
      /** The newest message answers a mastery check's question (isAssessAnswerTurn), with the check on: a
       *  "mastered" mark on this turn needs a correct verdict, so one with no verdict at all is refused. */
      answerTurn: boolean;
      /** The student's newest message as they typed it. */
      answered: string;
      masteryCheck: boolean;
    },
  ): Promise<TutorTurnResult> {
    const { budget, toolResultCap, toolDefs, offered, manifest, grounding, workedAnswerRules, firstTurnHold, dictionaryNote, answerCheck, masteryCheck } = prepared;
    let messages = prepared.messages;

    // Fit BEFORE the first call, and again after every reinjection, so a fat tool result evicts old
    // history rather than the student's current question. The grounding block is already inside the
    // student's newest message, so it is charged once, as part of that message.
    let fit = fitMessages(messages, budget);
    messages = fit.messages;
    let droppedTotal = fit.dropped;
    if (import.meta.env?.DEV) {
      console.info(`[budget] ${formatBudgetUsage(budget, fit.usage)}${fit.dropped ? ` · dropped ${fit.dropped}` : ""}`);
    }

    let streamedText = ""; // everything shown to the user this turn = what we persist
    const toolCalls: TutorTurnResult["toolCalls"] = prepared.appCall ? [prepared.appCall] : [];
    let usedKnowledgeUpdate = false;
    let endedNaturally = false; // the model gave a closing answer without calling a tool
    // Set when the provider reports the turn did not finish cleanly. "length" is included because
    // num_predict is now bounded by the budget's reserve slice, which makes hitting the output cap a
    // reachable outcome rather than a theoretical one.
    // Assigned inline rather than through a helper: TypeScript's control-flow analysis cannot see
    // writes made through a closure, so routing these through one narrows `interrupted` to null at
    // every later read and silently disables the checks below.
    let interrupted: "aborted" | "stalled" | "length" | null = null;
    let toolCallRecovery: TutorTurnResult["toolCallRecovery"] = null;
    // Every model call's text goes through a ReplyTextFilter before the student sees it or it is
    // saved: a tool call the model wrote as text never reaches either (textToolCalls.ts).
    const toolNames = [...toolRegistry.all().map((t) => t.name), ...offered];
    // A drawing a math.render or diagram.render call left in the reply (drawnCards.ts) ends on its own
    // line; whatever is shown next starts a new paragraph after it.
    let afterDrawing = false;
    // Whether anything but a drawing was shown this turn. A drawing answers the turn (no MIXED_UP_REPLY)
    // but says no verdict, so a checked answer whose reply was only a drawing still gets VERDICT_FALLBACK.
    let proseShown = false;
    const show = (text: string, drawing = false) => {
      if (!text) return;
      if (afterDrawing) {
        text = (text.startsWith("\n\n") ? "" : text.startsWith("\n") ? "\n" : "\n\n") + text;
        afterDrawing = false;
      }
      if (!drawing && text.trim()) proseShown = true;
      streamedText += text;
      turn.onText(text);
    };
    // On a turn of a mastery check, every model call's text then goes through the claim filter
    // (replyClaims.ts): a mastery claim with no mastery saved this turn, and a claim against the answer
    // check's verdict, never reach the student or the transcript. It holds each sentence until it ends.
    // On any other turn it passes text straight through.
    let masteryWritten = false;
    // For appMark: what the reply showed before the first card graded this turn, and whether the model's own
    // mark ran or the learner said no to it.
    let beforeCard: string | null = null;
    let modelMarked = false;
    const claimFilter = (check: AnswerCheck | null, answered: string) => new ReplyClaimFilter({
      verdict: check?.verdict ?? null,
      masteryWritten: () => masteryWritten,
      checkMastery: masteryCheck || !!check,
      answer: check ? { student: check.studentAnswer || answered, key: check.key } : undefined,
    });
    let claims = claimFilter(answerCheck, prepared.answered);
    // A pick on an ask_user.question card in a mastery check is the child's answer, so it gets the same
    // check as a typed one (cardTutorMessage). From then on the reply is held to that verdict: the claim
    // filter is a new one for it (the reply after the pick is a reply to a new answer), the fallback
    // lines say it, and a "mastered" mark is refused while any answer checked this turn is not correct.
    // Before this, a pick reached the model with no verdict, so a wrong pick could be praised and
    // marked mastered.
    const cardChecks: AnswerCheck[] = [];
    let verdictCheck = answerCheck;
    const earlierRemoved: TutorTurnResult["removedClaims"] = [];
    const checkCards = prepared.checkAnswers && (masteryCheck || !!answerCheck);
    // An answered ask_user.question card owes the child a reply (askCard.ts). Set when the child answers
    // one; cleared when a model call after it shows text. A model call after it that shows nothing and
    // calls nothing is made once more (gemma4:e4b answered the click-test card with an empty reply in
    // 5 of 8 headless runs, and every retry WITHOUT tools was empty too, so the request is repeated as
    // it was); a second empty one gets AFTER_ANSWER_REPLY below.
    let replyOwed = false;
    // The same for a tool round that drew no answer card (showsAnswerCard) while nothing was shown yet
    // this turn: a lookup's chip is not a reply, so an empty model call after it is made once more too.
    // A second empty one gets MIXED_UP_REPLY below.
    let answerOwed = false;
    let retriedEmpty = false;
    // Set when the child typed a safety disclosure into a card (TutorTurnResult.cardMessage).
    let cardMessage: string | null = null;
    // A model call that throws after this turn already showed something (text, or a card's question and
    // the child's answer) ends the turn as stalled instead of failing it, so what was shown is saved with
    // the stalled marker (persistedReply) and the chat says STALLED_TURN. Not when the student pressed
    // Stop: that keeps its own handling. The app's own topic picker (assessPicker.ts) does not count: it
    // runs with no model call, so with Ollama stopped the first model call fails after it, and keeping that
    // card and pick would save a "reply" no model wrote and tell the learner to close programs instead of
    // the plain Ollama line (friendlyError). That call fails the turn, as it did before the picker.
    let appCardEnd = 0;
    const keepsShown = () => !ctx.abort.aborted && !!streamedText.slice(appCardEnd).trim();
    // When code asks the check's question again after the reply (hintBack), the reply's own trailing
    // question is held back and dropped (answerCheck.ts TrailingQuestionHold, TerraTutor click test 2026-11-19 part 8,
    // issue 4). Text still held counts as said for the empty-reply retries below; a tool round lets it out.
    const hold = prepared.hintBack ? new TrailingQuestionHold() : null;
    const held = (text: string) => (hold ? hold.push(text) : text);
    // Before each later model call: a question the last call's text ended on, held across a refused mark, is
    // dropped as at the reply's end, and the new call's text starts after a break. Glued on ("What is 16 + 8?Keep
    // going, you are doing great."), it read as one sentence with a "?" and was dropped too, and after a card
    // it ran into the text before it (review of TerraTutor #262, 2026-11-20, nits 1 and 2).
    const nextCall = () => {
      if (!hold) return;
      show(hold.end());
      if (streamedText.trim() && !streamedText.endsWith("\n")) hold.push("\n\n");
    };

    for (let iteration = 0; ; iteration++) {
      if (shouldContinue(iteration, ctx).stop) break;
      if (iteration > 0) nextCall();

      let iterationText = ""; // text emitted before any tool call in THIS model turn
      const pendingCalls: Array<{ id: string; name: string; args: unknown; fromText?: true; byApp?: true }> = [];
      // A text call is run only for a tool offered on this request, exactly as a native one would be.
      const filter = new ReplyTextFilter(toolNames, (name) => !!toolDefs && offered.has(name));
      // The app's topic picker takes the first model call's place: it goes through the same steps as a
      // card the model made (the claim filter, the model's record of the call, dispatch, a typed disclosure).
      if (iteration === 0 && prepared.appAsk) pendingCalls.push({ ...prepared.appAsk });
      else try {
        for await (const ev of callLLMTurn(messages, turn.config, { tools: toolDefs, tier: ctx.modelTier, signal: ctx.abort })) {
          if (ev.type === "text") { const text = held(claims.push(filter.push(ev.delta))); iterationText += text; show(text); }
          else if (ev.type === "tool_call") {
            // Namespace the id with the iteration. Ollama restarts its counter on each generator, so
            // iteration 1 and 2 both emit "call_0" — and the chat surface keys tool chips by id, so the
            // second call silently ERASED the first one's card.
            pendingCalls.push({ id: kernelCallId(iteration, ev.id), name: ev.name, args: ev.args });
          }
          else if (ev.type === "done") {
            if (ev.finishReason === "aborted") interrupted = "aborted";
            else if (ev.finishReason === "stalled") interrupted = "stalled";
            else if (ev.finishReason === "length") interrupted = "length";
          }
        }
      } catch (e) {
        // Ollama could not parse the tool call the model wrote and returned an error instead of a
        // reply. Tools are optional help; a reply without them beats a failed turn. So this turn is
        // answered by the no-tools call below, once. llm.ts only raises this error when nothing from
        // the request reached the student, and the no-tools call cannot raise it, so there is no loop.
        // A later model call that fails (Ollama crashed, ran out of memory or refused the connection
        // between calls of one turn) keeps what the child already saw this turn, a card's question and
        // their answer included: the turn ends as stalled, as when a stream breaks off mid-reply.
        // Every other error with nothing shown yet fails the turn as before. A kept turn is logged here,
        // because ChatTab's "turn failed" line never sees it and llm.ts does not log the failure.
        if (!(e instanceof OllamaToolCallParseError)) {
          if (!keepsShown()) throw e;
          log.error("TutorEngine", "later model call failed; turn kept as stalled", e);
          interrupted = "stalled";
        } else {
          toolCallRecovery = { iteration, error: e.ollamaError };
          if (import.meta.env?.DEV) console.info(`[turn] tool call unparseable at call ${iteration} (${e.ollamaError}); answering without tools`);
          break;
        }
      }
      const tail = held(claims.push(filter.end()) + claims.flush());
      iterationText += tail;
      show(tail);
      // A tool call follows the text: what it held is let out first, so a card or drawing sits under the whole
      // text. Not for a "mastered" mark alone: on this turn code refuses it and nothing is shown, so the reply
      // after it can still end on the held question.
      const refusedOnly = pendingCalls.length > 0 && pendingCalls.every((c) => c.name === MARK_MASTERED_TOOL && marksMastered(c.args));
      if (hold && (pendingCalls.length > 0 || filter.stoppedAtCall) && !refusedOnly) {
        const released = hold.flush();
        iterationText += released;
        show(released);
      }
      const said = iterationText + (hold?.held ?? "");
      if (said.trim()) { replyOwed = false; answerOwed = false; }
      // A tool call written as text, when the provider returned none: run the first one whose tool was
      // offered (the filter stopped the text there) through the same dispatch as a native call.
      if (pendingCalls.length === 0 && filter.stoppedAtCall) {
        const call = filter.calls.find((c) => offered.has(c.name))!;
        pendingCalls.push({ id: kernelCallId(iteration, "text_0"), name: call.name, args: call.args, fromText: true });
      }

      // A hard interruption (Stop, or a stalled stream) ends the turn immediately. "length" does NOT:
      // the model may have emitted valid tool calls before running out of room, and dropping them
      // would lose work AND skip the forced final answer below, leaving the student with nothing.
      if (interrupted && interrupted !== "length") break;
      if (pendingCalls.length === 0 && (replyOwed || answerOwed) && !said.trim() && !interrupted && !retriedEmpty) { retriedEmpty = true; continue; }
      if (pendingCalls.length === 0) { endedNaturally = true; break; }

      // A card whose buttons do not answer its question is repaired first, by code (askCard.ts); the
      // repaired card is what the claim filter, the child, the model's record and the result all see.
      // An ask_user.question card is the tutor speaking too: on a turn of a mastery check its question and
      // choice labels go through the claim filter before the student sees them (and before the model's
      // own record of the call, so it does not read back what was taken out). A card left with no
      // question or fewer than two choices is not shown; the model is told.
      const refusedCards = new Set<string>();
      for (const call of pendingCalls) {
        if (call.name !== ASK_USER_TOOL) continue;
        call.args = repairAskCard(call.args);
        const shown = claims.card(call.args);
        if (shown === null) refusedCards.add(call.id);
        else call.args = shown;
      }

      // Record the assistant's tool-call turn, then dispatch each call and reinject its result.
      messages.push({
        role: "assistant",
        content: iterationText + (hold?.held ?? ""),
        tool_calls: pendingCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      for (const call of pendingCalls) {
        if (ctx.abort.aborted) { interrupted = "aborted"; break; }
        // A "mastered" mark on an answer the check did not find correct is refused by code: the
        // verdict is the app's, not the model's. Nothing runs and nothing is shown; the model is told.
        // Nor on a safety-disclosure turn, where nothing is graded: what the child said is not an answer.
        // Nor on a check's answer turn that no check gave a verdict (TerraTutor #229): the tutor's message
        // asked nothing with one right answer, or the child asked what a word means, so nothing was found correct.
        // Nor on a turn whose answer was to a hint's own question (AnswerCheck.on), a card picked in the turn
        // included: code asks the check's own question again after the reply, so no mark that turn can stand
        // beside it (ported from TerraTutor #258; a card that asked the hint's question passed there before).
        const checked = [answerCheck, ...cardChecks].filter((c): c is AnswerCheck => !!c);
        const unchecked = prepared.answerTurn && checked.length === 0;
        const hintTurn = answerCheck?.on === "hint";
        const refused = call.name === MARK_MASTERED_TOOL && marksMastered(call.args) && (prepared.disclosureTurn ||
          unchecked || hintTurn || checked.some((c) => c.verdict !== "correct"));
        // On a safety-disclosure turn, and every later turn in its thread, nothing the learner said is kept:
        // the knowledge files, the notebook and a flashcard are refused the same way. Nothing runs and
        // nothing is shown; the model is told.
        const keepsWords = prepared.keepsNothing && KEEPS_WORDS.has(call.name);
        let result: ToolDispatchResult;
        if (refused) result = { name: call.name, ok: false, error: prepared.disclosureTurn ? MASTERY_REFUSED_DISCLOSURE : unchecked ? MASTERY_REFUSED_UNCHECKED : hintTurn ? MASTERY_REFUSED_HINT : MASTERY_REFUSED };
        else if (keepsWords) result = { name: call.name, ok: false, error: NOT_SAVED_DISCLOSURE };
        else if (refusedCards.has(call.id)) result = { name: call.name, ok: false, error: CARD_REFUSED };
        // eslint-disable-next-line no-await-in-loop -- tools run sequentially by design
        else result = await dispatchToolCall(call, ctx, turn.onToolEvent, offered);
        toolCalls.push({ name: call.name, args: call.args, ok: result.ok, ...(call.fromText ? { fromText: true as const } : {}), ...(call.byApp ? { byApp: true as const } : {}) });
        if (call.name === KNOWLEDGE_UPDATE_TOOL && result.ok) usedKnowledgeUpdate = true;
        if (call.name === MARK_MASTERED_TOOL && result.ok && marksMastered(call.args)) masteryWritten = true;
        if (call.name === MARK_MASTERED_TOOL && (result.ok || result.error === declinedError(call.name))) modelMarked = true;
        // An equation or diagram is shown as reply text where the call ran, so it is saved with the reply
        // and stays in the thread (drawnCards.ts), rather than living only in the turn's tool events.
        if (result.ok) {
          const drawing = drawnCard(streamedText, call.name, call.args);
          if (drawing) { show(drawing, true); afterDrawing = true; }
        }
        // The child answered a card: the question and their answer join the reply's text, so they are
        // shown in the stream and saved with the reply once the card is gone (askCard.ts answeredCard).
        let cardNote = "";
        if (call.name === ASK_USER_TOOL && result.ok && !ctx.abort.aborted) {
          const answer = result.value as QuestionResult;
          const card = call.args as AskCard;
          // Words the child typed into the card that read as a safety disclosure are not an answer to it.
          // Checked only here, on the turn's newest input: the turn's system prompt was built from the
          // message before the card, so the turn ends now, at the card's question, with the words never
          // echoed, graded or sent to the model, and the caller sends them as the child's own message
          // (TutorTurnResult.cardMessage). The same check, with the same grade, as a typed chat message.
          if (answer.typed && isSafetyDisclosure(answer.answer, turn.grade ?? null)) {
            show(askedCard(streamedText, card.question));
            cardMessage = answer.answer;
            // An earlier card's answer this turn left a reply owed; the turn now ends at this card instead.
            replyOwed = false;
            break;
          }
          const shownBefore = streamedText;
          show(answeredCard(streamedText, card.question, { text: answer.answer, typed: answer.typed }));
          if (call.byApp) appCardEnd = streamedText.length;
          replyOwed = true;
          retriedEmpty = false;
          // A typed answer that asks for something ("I don't know", "can you help?") is not graded, as on
          // a typed turn (readsAsAnswer). A pick always is; a card that asks nothing with one right answer
          // (a topic picker) gets no verdict from the key call. The app's own picker is one, so it skips the call.
          if (checkCards && !call.byApp && (!answer.typed || readsAsAnswer(answer.answer))) {
            // eslint-disable-next-line no-await-in-loop -- the reply after the pick needs the verdict
            const check = await checkAnswer(cardTutorMessage(iterationText, card), answer.answer, turn.config, { tier: ctx.modelTier, signal: ctx.abort });
            if (check && !ctx.abort.aborted) {
              if (!cardChecks.length) beforeCard = shownBefore;
              cardChecks.push(check);
              verdictCheck = check;
              earlierRemoved.push(...claims.removed);
              claims = claimFilter(check, answer.answer);
              cardNote = `\n\n${answerCheckNote(check)}`;
            }
          }
        }
        // Cap what goes back into context. The model sees a visible truncation marker rather than a
        // silently shortened result it would otherwise answer from with false confidence.
        const payload = result.ok
          ? (result.modelText ?? JSON.stringify(result.value ?? {})) + cardNote
          : `ERROR: ${result.error}`;
        messages.push({
          role: "tool",
          name: call.name,
          tool_call_id: call.id,
          content: capText(payload, toolResultCap),
        });
      }
      // No further model call, and no fallback line: the child's own message is next.
      if (cardMessage !== null && !ctx.abort.aborted) { endedNaturally = true; break; }
      // "I can look that up for you." before the lookup answers nothing either (lookupAnnouncement.ts).
      if ((!streamedText.trim() || onlyAnnouncesLookup(streamedText)) && !toolCalls.some(showsAnswerCard)) answerOwed = true;
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
    // in `messages`. The same call answers a turn whose tool call Ollama could not parse; that one
    // also drops the <tools> manifest from the system prompt, so the model is not told about tools it
    // cannot call and does not try the same malformed call as plain text.
    const hardStopped = interrupted === "aborted" || interrupted === "stalled";
    if (!endedNaturally && !hardStopped && !ctx.abort.aborted) {
      const finalMessages = toolCallRecovery && manifest ? withoutManifest(messages, manifest) : messages;
      // No tools on this call, so a call written as text is only dropped.
      const filter = new ReplyTextFilter(toolNames);
      nextCall();
      try {
        for await (const ev of callLLMTurn(finalMessages, turn.config, { tier: ctx.modelTier, signal: ctx.abort })) {
          if (ev.type === "text") { const text = claims.push(filter.push(ev.delta)); if (text.trim()) replyOwed = false; show(held(text)); }
          else if (ev.type === "done") {
            if (ev.finishReason === "aborted") interrupted = "aborted";
            else if (ev.finishReason === "stalled") interrupted = "stalled";
            else if (ev.finishReason === "length") interrupted = "length";
          }
        }
      } catch (e) {
        // As in the loop above: what the child already saw this turn is kept, as a stalled turn.
        if (!keepsShown()) throw e;
        log.error("TutorEngine", "later model call failed; turn kept as stalled", e);
        interrupted = "stalled";
      }
      const tail = claims.push(filter.end()) + claims.flush();
      if (tail.trim()) replyOwed = false;
      show(held(tail));
    }

    // The abort flag is authoritative. `interrupted` can miss a Stop that lands during or after the
    // final tool dispatch — the loop then exits via shouldContinue, which discards its own reason —
    // and the turn would report "max_iterations", which the caller does not treat as partial. The
    // fragment would then be persisted unmarked and reflected into the course knowledge files.
    // A recovered turn that the no-tools call finished is complete, not capped.
    const stopReason: TutorTurnResult["stopReason"] =
      interrupted ?? (ctx.abort.aborted ? "aborted" : endedNaturally || toolCallRecovery ? "complete" : "max_iterations");

    // The reply's end: a question still held is dropped, as code asks the check's question after it. On a
    // turn the student stopped, code adds nothing, and what was held is let out as it came.
    if (hold) show(stopReason === "aborted" ? hold.flush() : hold.end());

    // An answer the check gave a verdict on always gets one: a reply the claim filter emptied (or the
    // model left empty, or left only a drawing) says the verdict in one plain line.
    // "I can look that up for you." alone says no verdict either (lookupAnnouncement.ts), tool round or not.
    const announcedOnly = onlyAnnouncesLookup(streamedText);
    const gapBefore = () => !streamedText.trim() || streamedText.endsWith("\n\n") ? "" : streamedText.endsWith("\n") ? "\n" : "\n\n";
    if (verdictCheck && cardMessage === null && (!proseShown || announcedOnly) && stopReason !== "aborted" && stopReason !== "stalled") {
      // Before code's "Now back to the question:" the line asks nothing (HINT_LEAD): one open question only.
      const line = prepared.hintBack && verdictCheck === answerCheck ? HINT_LEAD[verdictCheck.verdict] : VERDICT_FALLBACK[verdictCheck.verdict];
      show(`${announcedOnly ? gapBefore() : ""}${line}`);
    }

    // Never a blank turn: a reply that ended with nothing to show (the model wrote nothing, or only a
    // tool call the filter removed) and drew no answer card says so in one plain line, which is shown and
    // saved like any reply. A tool that ran and left only a chip does not count: the chip is gone when the
    // thread is reopened, and it answers nothing. A turn the student stopped, or one that stalled, keeps
    // its own handling.
    // A turn that showed only "I can look that up for you." is one too, with or without a lookup after it
    // (after one, an empty call was already made once more).
    const blank = !streamedText.trim() || onlyAnnouncesLookup(streamedText);
    if (blank && !toolCalls.some(showsAnswerCard) && stopReason !== "aborted" && stopReason !== "stalled") {
      show(`${gapBefore()}${MIXED_UP_REPLY}`);
    }

    // Never a turn that ends on the child's answer to a card: that was the click test's dead end.
    // After a checked pick, the line says the verdict instead.
    if (replyOwed && stopReason !== "aborted" && stopReason !== "stalled") {
      show(verdictCheck && verdictCheck !== answerCheck ? VERDICT_FALLBACK[verdictCheck.verdict] : AFTER_ANSWER_REPLY);
    }

    // An answer to the hint's own question was right, but the check's question is still open: code asks it
    // again at the end, so the next try is checked against it (answerCheck.ts checkedMessage reads only what
    // follows HINT_ANSWER_BACK) and nothing the reply asked can stand in for it. On a stalled turn too: it is
    // code's text, and the question is still owed (else the next turn keys the fragment's own question). Not
    // on a turn the student stopped.
    if (prepared.hintBack && stopReason !== "aborted") {
      show(`${gapBefore()}${prepared.hintBack}`);
    }

    // A reply that says it shows a picture and shows none: the saved reply loses the claim, and the
    // first one's place offers to draw (pictureClaims.ts). The stream already showed it; the saved reply
    // takes its place on screen. Not on a turn the student stopped or that stalled: that fragment is
    // saved as it came, with its marker.
    if (stopReason !== "aborted" && stopReason !== "stalled" && !showsPicture(streamedText, toolCalls)) {
      streamedText = withoutPictureClaims(streamedText);
    }

    // Which retrieved passages did the answer DEMONSTRABLY reuse? Computed by n-gram overlap, never
    // by asking the model. This is what drives the citation chip, so a chip cannot be fabricated —
    // and an empty result against non-empty hits is the honest "answered from general knowledge"
    // case the UI is required to show rather than quietly drop.
    const usedHits = groundedIn(streamedText, grounding.hits);

    // A list of choices the model wrote instead of calling ask_user.question becomes buttons anyway.
    // Read from the finished text by code; never on a turn where the model asked through the tool (the
    // app's topic picker is answered before the reply is written, so it does not count).
    const replyChoices = stopReason === "complete" && !toolCalls.some((c) => c.name === ASK_USER_TOOL && !c.byApp)
      ? choicesInReply(streamedText)
      : null;

    return {
      text: streamedText,
      toolCalls,
      usedKnowledgeUpdate,
      stopReason,
      usage: { contextTokens: budget.total, promptTokens: fit.usage.total, droppedMessages: droppedTotal },
      grounding,
      usedHits,
      workedAnswerRules,
      firstTurnHold,
      askedWord: prepared.askedWord,
      dictionaryNote,
      dictionaryShown: prepared.dictionaryShown,
      arithmeticFact: prepared.arithmeticFact,
      toolCallRecovery,
      replyChoices,
      answerCheck,
      cardChecks,
      removedClaims: [...earlierRemoved, ...claims.removed],
      cardMessage,
      disclosure: prepared.keepsNothing,
      fixedReply: false,
      markInput: { beforeCard, modelMarked },
    };
  }
}

export const tutorEngine = new TutorEngine();
