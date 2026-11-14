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

import { callLLMTurn, OllamaToolCallParseError, type NeutralMessage, type ProviderToolDef } from "../llm";
import type { LLMConfig } from "../../types";
import type { ToolContext } from "../tools/EduTool";
import { selectTools, buildProviderToolDefs, dispatchToolCall, type ToolUIEvent, type ToolDispatchResult } from "./toolDispatch";
import { toolRegistry } from "../tools/registry";
import { evaluatePermission } from "../permissions/evaluate";
import { loadPermissionRules } from "../permissions/store";
import { shouldContinue } from "./stopHooks";
import { toolsLayer } from "./systemPrompt";
import { turnSystemPrompt, WORKED_ANSWER_RULES } from "./outputRules";
import { isFirstTurnHold, withFirstTurnHold } from "./attemptFirst";
import { isCheckBeforePraiseTurn, withCheckBeforePraise } from "./checkBeforePraise";
import { askedWord, lookupDictionary, withDictionaryNote, type DictionaryShown } from "./defineWord";
import { lookupWord } from "../dictionary";
import { budgetFor, fitMessages, capText, formatBudgetUsage, DEFAULT_CONTEXT_TOKENS, type Budget } from "./budget";
import { ground, groundedIn, shouldRetrieve, EMPTY_GROUNDING, type Grounding, type RetrievalMode } from "./ground";
import { shouldGloss, glossQuestion, type GlossResult } from "./gloss";
import { ReplyTextFilter } from "./textToolCalls";
import { MIXED_UP_REPLY } from "../plain-language";
import { choicesInReply, type ReplyChoices } from "./replyChoices";
import { asksForFlashcard, cardFromRequest, withFlashcardNote, FLASHCARD_TOOL, type Card } from "./flashcardRequest";
import { isAssessAnswerTurn, checkAnswer, withAnswerCheckNote, type AnswerCheck } from "./answerCheck";
import { ReplyClaimFilter, VERDICT_FALLBACK } from "./replyClaims";

const KNOWLEDGE_UPDATE_TOOL = "knowledge.update_map";
const ASK_USER_TOOL = "ask_user.question";
const MARK_MASTERED_TOOL = "progress.mark_mastered";
/** What the model is told when it tries to mark mastered on an answer code did not find correct. */
export const MASTERY_REFUSED =
  "Not saved: the app checked the student's answer and did not find it correct, so this subtopic can't be marked mastered now.";
const marksMastered = (args: unknown) => !!args && typeof args === "object" && (args as { status?: unknown }).status === "mastered";
// The id of the flashcard.create call the app makes itself (flashcard stage). It never reaches a
// provider: the model sees a note, not a tool call, so no tool_use id rules apply.
const APP_FLASHCARD_CALL_ID = "app_flashcard";

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
}

export interface TutorTurnResult {
  text: string;
  // `byApp` marks a call the app made itself rather than the model (the flashcard stage,
  // flashcardRequest.ts), so an eval can tell the model's tool choice from the app's. `fromText` marks a
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
  // Sentences the reply filter (replyClaims.ts) took out or trimmed: mastery claims with no mastery
  // saved, and claims against the answer check's verdict. As the model wrote them.
  removedClaims: Array<{ kind: "mastery" | "verdict"; text: string }>;
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

export class TutorEngine {
  async run(turn: TutorTurn, ctx: ToolContext): Promise<TutorTurnResult> {
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
    // notes govern a problem turn, and one note per turn keeps each lever's effect its own. The lookup
    // starts here and is awaited after retrieval; it never throws, and a miss leaves the turn unchanged.
    const newest = messages[messages.length - 1];
    const asked = newest?.role === "user" ? askedWord(newest.content) : null;
    const dictionaryLookup = asked && !firstTurnHold && !checkBeforePraiseTurn && turn.dictionary !== "off"
      ? lookupDictionary(asked.word, lookupWord, undefined, ctx.abort, turn.senseRank === "off" ? undefined : asked.context)
      : Promise.resolve(null);
    // The answer check (answerCheck.ts): the student's answer to the tutor's question in a mastery
    // check gets a verdict from code (a blind key, a code compare, a structured grading call) before
    // the reply is written. Started here, awaited after retrieval; it never throws. On a turn it gives a
    // verdict, its note replaces the check-before-praise note: the verdict is a fact, not a request to
    // check.
    const answerCheckRun = turn.answerCheck !== "off" && !firstTurnHold && !asked && isAssessAnswerTurn(conversation, ctx.activeSkill?.name)
      ? checkAnswer(conversation[conversation.length - 2].content, newest.content, turn.config, { tier: ctx.modelTier, signal: ctx.abort })
      : Promise.resolve(null);

    let eduTools = await selectTools(ctx);

    // The flashcard stage (flashcardRequest.ts): a student who asks for a card gets one made by the
    // app, through flashcard.create's own dispatch (permissions, confirm card, chip), whatever the
    // mode. It does not run at all when the permission rules deny the tool. A chip shows while the
    // card call runs, so a slow model is not a blank screen. Once a card has been dispatched, the model
    // is not offered the tool again this turn, so it cannot make a second card. A failed card call
    // clears the chip and the turn goes on as before.
    let appCard: { call: TutorTurnResult["toolCalls"][number]; saved: Card | null } | null = null;
    const cardTool = toolRegistry.get(FLASHCARD_TOOL);
    if (
      turn.flashcardStage !== "off" && cardTool && newest?.role === "user" && asksForFlashcard(newest.content) &&
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

    const offered = new Set(eduTools.map((t) => t.name));
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
    } else if (checkBeforePraiseTurn) {
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
    if (appCard) {
      // Same place as the other notes: after the grounding block and the student's text.
      const idx = messages.map((m) => m.role).lastIndexOf("user");
      messages[idx] = { ...messages[idx], content: withFlashcardNote(messages[idx].content, appCard.saved) };
    }
    if (import.meta.env?.DEV) {
      const t = grounding.trace;
      console.info(`[ground] ${t.skipped ? `skipped: ${t.skipped}` : `${t.hitTitles.length} hit(s) — ${t.hitTitles.join(", ")}`} · ${t.candidates} candidate(s) · top ${t.topScore.toFixed(2)} · ${t.blockTokens} tok${t.error ? ` · ${t.error}` : ""}`);
    }

    try {
      return await this.respond(turn, ctx, { appCall: appCard?.call ?? null, messages, budget, toolResultCap, toolDefs, offered, manifest, grounding, workedAnswerRules, firstTurnHold, askedWord: asked?.word ?? null, dictionaryNote, dictionaryShown: dictionary?.shown ?? null, answerCheck });
    } catch (e) {
      throw new TutorTurnError(e, grounding);
    }
  }

  // The model loop, after grounding: everything that calls the model and can fail.
  private async respond(
    turn: TutorTurn,
    ctx: ToolContext,
    prepared: {
      appCall: TutorTurnResult["toolCalls"][number] | null;
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
      answerCheck: AnswerCheck | null;
    },
  ): Promise<TutorTurnResult> {
    const { budget, toolResultCap, toolDefs, offered, manifest, grounding, workedAnswerRules, firstTurnHold, dictionaryNote, answerCheck } = prepared;
    let messages = prepared.messages;

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
    const show = (text: string) => { if (text) { streamedText += text; turn.onText(text); } };
    // After that, every model call's text goes through the claim filter (replyClaims.ts): a mastery
    // claim with no mastery saved this turn, and a claim against the answer check's verdict, never reach
    // the student or the transcript. It holds each sentence until it ends.
    let masteryWritten = false;
    const claims = new ReplyClaimFilter({ verdict: answerCheck?.verdict ?? null, masteryWritten: () => masteryWritten });

    for (let iteration = 0; ; iteration++) {
      if (shouldContinue(iteration, ctx).stop) break;

      let iterationText = ""; // text emitted before any tool call in THIS model turn
      const pendingCalls: Array<{ id: string; name: string; args: unknown; fromText?: true }> = [];
      // A text call is run only for a tool offered on this request, exactly as a native one would be.
      const filter = new ReplyTextFilter(toolNames, (name) => !!toolDefs && offered.has(name));
      try {
        for await (const ev of callLLMTurn(messages, turn.config, { tools: toolDefs, tier: ctx.modelTier, signal: ctx.abort })) {
          if (ev.type === "text") { const text = claims.push(filter.push(ev.delta)); iterationText += text; show(text); }
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
        // Every other error fails the turn as before.
        if (!(e instanceof OllamaToolCallParseError)) throw e;
        toolCallRecovery = { iteration, error: e.ollamaError };
        if (import.meta.env?.DEV) console.info(`[turn] tool call unparseable at call ${iteration} (${e.ollamaError}); answering without tools`);
        break;
      }
      const tail = claims.push(filter.end()) + claims.flush();
      iterationText += tail;
      show(tail);
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
      if (pendingCalls.length === 0) { endedNaturally = true; break; }

      // Record the assistant's tool-call turn, then dispatch each call and reinject its result.
      messages.push({
        role: "assistant",
        content: iterationText,
        tool_calls: pendingCalls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
      });
      for (const call of pendingCalls) {
        if (ctx.abort.aborted) { interrupted = "aborted"; break; }
        // A "mastered" mark on an answer the check did not find correct is refused by code: the
        // verdict is the app's, not the model's. Nothing runs and nothing is shown; the model is told.
        const refused = call.name === MARK_MASTERED_TOOL && marksMastered(call.args) && !!answerCheck && answerCheck.verdict !== "correct";
        let result: ToolDispatchResult;
        if (refused) result = { name: call.name, ok: false, error: MASTERY_REFUSED };
        // eslint-disable-next-line no-await-in-loop -- tools run sequentially by design
        else result = await dispatchToolCall(call, ctx, turn.onToolEvent, offered);
        toolCalls.push({ name: call.name, args: call.args, ok: result.ok, ...(call.fromText ? { fromText: true as const } : {}) });
        if (call.name === KNOWLEDGE_UPDATE_TOOL && result.ok) usedKnowledgeUpdate = true;
        if (call.name === MARK_MASTERED_TOOL && result.ok && marksMastered(call.args)) masteryWritten = true;
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
    // in `messages`. The same call answers a turn whose tool call Ollama could not parse; that one
    // also drops the <tools> manifest from the system prompt, so the model is not told about tools it
    // cannot call and does not try the same malformed call as plain text.
    const hardStopped = interrupted === "aborted" || interrupted === "stalled";
    if (!endedNaturally && !hardStopped && !ctx.abort.aborted) {
      const finalMessages = toolCallRecovery && manifest ? withoutManifest(messages, manifest) : messages;
      // No tools on this call, so a call written as text is only dropped.
      const filter = new ReplyTextFilter(toolNames);
      for await (const ev of callLLMTurn(finalMessages, turn.config, { tier: ctx.modelTier, signal: ctx.abort })) {
        if (ev.type === "text") show(claims.push(filter.push(ev.delta)));
        else if (ev.type === "done") {
          if (ev.finishReason === "aborted") interrupted = "aborted";
          else if (ev.finishReason === "stalled") interrupted = "stalled";
          else if (ev.finishReason === "length") interrupted = "length";
        }
      }
      show(claims.push(filter.end()) + claims.flush());
    }

    // The abort flag is authoritative. `interrupted` can miss a Stop that lands during or after the
    // final tool dispatch — the loop then exits via shouldContinue, which discards its own reason —
    // and the turn would report "max_iterations", which the caller does not treat as partial. The
    // fragment would then be persisted unmarked and reflected into the course knowledge files.
    // A recovered turn that the no-tools call finished is complete, not capped.
    const stopReason: TutorTurnResult["stopReason"] =
      interrupted ?? (ctx.abort.aborted ? "aborted" : endedNaturally || toolCallRecovery ? "complete" : "max_iterations");

    // An answer the check gave a verdict on always gets one: a reply the claim filter emptied (or the
    // model left empty) says the verdict in one plain line.
    if (answerCheck && !streamedText.trim() && stopReason !== "aborted" && stopReason !== "stalled") {
      show(VERDICT_FALLBACK[answerCheck.verdict]);
    }

    // Never a blank turn: a reply that ended with nothing to show (the model wrote nothing, or only a
    // tool call the filter removed) and ran no tool says so in one plain line, which is shown and saved
    // like any reply. A turn the student stopped, or one that stalled, keeps its own handling.
    if (!streamedText.trim() && toolCalls.length === 0 && stopReason !== "aborted" && stopReason !== "stalled") {
      show(MIXED_UP_REPLY);
    }

    // Which retrieved passages did the answer DEMONSTRABLY reuse? Computed by n-gram overlap, never
    // by asking the model. This is what drives the citation chip, so a chip cannot be fabricated —
    // and an empty result against non-empty hits is the honest "answered from general knowledge"
    // case the UI is required to show rather than quietly drop.
    const usedHits = groundedIn(streamedText, grounding.hits);

    // A list of choices the model wrote instead of calling ask_user.question becomes buttons anyway.
    // Read from the finished text by code; never on a turn that asked through the tool.
    const replyChoices = stopReason === "complete" && !toolCalls.some((c) => c.name === ASK_USER_TOOL)
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
      toolCallRecovery,
      replyChoices,
      answerCheck,
      removedClaims: claims.removed,
    };
  }
}

export const tutorEngine = new TutorEngine();
