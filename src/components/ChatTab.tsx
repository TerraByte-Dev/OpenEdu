import { useState, useEffect, useRef, useMemo, memo } from "react";
import type { Course, ChatMessage, Syllabus, NotebookSearchResult } from "../types";
import {
  getChatMessages, saveChatMessage, getTutorInstructions, setCourseSprite, countDueFlashcards,
  createChatThread, touchChatThread,
} from "../lib/db";
import { deriveThreadTitle } from "../lib/thread-title";
import { threadSwitchAbortsTurn, turnIsShown, turnLanding } from "../lib/turn-thread";
import { transcriptLoader, type TranscriptLoader } from "../lib/thread-transcript";
import { buildSystemPrompt } from "../lib/curriculum";
import { log } from "../lib/llm";
import { getChatTurnConfig, getRetrievalMode, getReadAloudAuto } from "../lib/store";
import { gradePromptLayer, isEarlyReader, autoReadAloud, type Grade } from "../lib/grade";
import { useReadAloud } from "../lib/useReadAloud";
import { chatCardSpeech, speechAfterNotice, unreadText } from "../lib/speech";
import { getKnowledgeSummary, updateKnowledgeFiles } from "../lib/knowledge";
import { TUTOR_MODES, type TutorModeId } from "../lib/tutor-modes";
import { tutorEngine, personaIdentityLayer, suggestFollowUps, chipsBesideChoices, hasTriedOpenQuestion, citationNote, quotedChipLabel, QUOTED_CHIP_TOOLTIP, persistedReply, type TutorTurn, type ToolUIEvent, type Suggestion, type CitationNote, type ReplyChoices } from "../lib/kernel";
import { resolvePersona } from "../lib/skills";
import { chatTurnMode, chatTurnSkills } from "../lib/kernel/chatSkills";
import { SPRITE_PERSONAS, getSpritePersona } from "../lib/sprites/registry";
import type { ToolContext, AskChoice } from "../lib/tools";
import { renderChatMarkdown, ensureChatKatex, isChatKatexReady } from "../lib/chat-markdown";
import { splitReplyDiagrams } from "../lib/mermaid-source";
import { displayReplyText } from "../lib/kernel/textToolCalls";
import { repeatsQuestion } from "../lib/kernel/askCard";
import { isHealthTopic, HEALTH_NOTICE } from "../lib/health-notice";
import { isSafetyDisclosure, SAFETY_NOTICE } from "../lib/child-safety";
import { describeToolActivity, describeToolDone, confirmCardQuestion, CONFIRM_CHOICES, friendlyError, messageNotSaved, STALLED_TURN } from "../lib/plain-language";
import MermaidBlock from "./MermaidBlock";
import { CompanionSprite } from "./CompanionSprite";
import { DictionaryCard } from "./DictionaryCard";
import { dictionaryCard, cardStartsOpen, cardSpeech, type DictionaryCard as DictionaryCardData } from "../lib/dictionary-card";
import { LIBRARY_NAME } from "../lib/product";
import { AI_DISCLOSURE } from "../lib/ai-notice";
import { IconMediaStop, IconPaperPlane, IconVolumeUp } from "./icons";

// Models already reported as tool-less this session, so the DEV notice prints once per model.
const toolsSuppressedLogged = new Set<string>();

// The dictionary card for a tutor reply, by the reply's message id (#251 PR 3): the entry the tutor was
// given on that turn (lib/dictionary-card.ts). Kept for this app session only: it is not saved, so
// after a restart the reply shows without it. Never read when building a request.
const dictionaryCards = new Map<string, DictionaryCardData>();

interface ChatTabProps {
  courseId: string;
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  seedTopic?: string;
  onSeedConsumed?: () => void;
  // Deep-link a library citation chip → open that card in the Resources tab (handled by CourseView).
  onOpenResource?: (id: string) => void;
  // Deep-link a flashcard.review_due chip → open the Review tab (handled by CourseView).
  onOpenReview?: () => void;
  // Thread selection moved up to CourseView so the left rail can own the conversation list — a
  // header dropdown was always a workaround for not having a column. ChatTab still owns the MESSAGES
  // (they are its business); it just no longer decides which thread is open.
  threadId: string | null;
  // A thread is created lazily on first send, so the parent has to be told when one appears.
  onThreadCreated: (threadId: string) => void;
  // Bumps the thread's updated_at so the rail can re-sort by real activity.
  onThreadActivity: () => void;
  // The tutor saved a progress mark this turn (progress.mark_mastered), so the course view reloads.
  onProgressChanged?: () => void;
  // The active learner's grade (#243): the reading-level line in the system prompt, larger text for
  // K-2, and whether replies read themselves aloud. null = not set: none of it applies.
  learnerId: string;
  grade: Grade | null;
}

// The read-aloud ids of the two cards that hold a turn open (a question card, the Allow / Don't allow
// card), so answering a card stops it being read. The buttons for choices a reply wrote as a list
// (replyChoices) share ASK_CARD_READ: they show only when no ask_user card is pending, so the two never
// show at once.
const ASK_CARD_READ = "card:ask";
const CONFIRM_CARD_READ = "card:confirm";

// Words typed into a question card that the kernel handed back (TutorTurnResult.cardMessage), already
// saved as the child's own message (`saved`) in the thread they belong to, and still owed a reply.
interface CardMessage { thread: string; saved: ChatMessage }

export default function ChatTab({ courseId, course, level, currentSyllabus, seedTopic, onSeedConsumed, onOpenResource, onOpenReview, threadId, onThreadCreated, onThreadActivity, onProgressChanged, learnerId, grade }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  // The turn's reply is saved and in the transcript, so the streaming bubble stops showing it while the
  // turn finishes (chips, notices). Without it the reply showed twice for a moment.
  const [replyLanded, setReplyLanded] = useState(false);
  const [chatError, setChatError] = useState("");
  // The teaching mode for the NEXT turn. Set by tapping a chip that carries one; reset after every
  // send. With none, the turn's mode comes from the conversation (chatSkills.ts chatTurnMode: the answers
  // to a "Check if I've got this" chip's check stay in assess). There is no mode bar any more — asking the
  // student to classify their own intent before they have asked their question was the one thing they
  // came for help with. Persistent pedagogy lives on the persona instead (the WHO axis), so this is a
  // per-turn override.
  const [pendingMode, setPendingMode] = useState<TutorModeId | null>(null);
  // Phase 4b persona (WHO axis). Local mirror of course.sprite_id so a mid-course switch reflects
  // immediately; written through to the DB on switch. resolvePersona maps it to a persona skill.
  const [spriteId, setSpriteId] = useState<string | null>(course.sprite_id ?? null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  // KaTeX is lazy-loaded (chat-markdown). Kick it off on mount; once it is ready every reply's HTML is
  // rebuilt (`katexReady` is a prop of the memoized bubbles) so any inline math in already-rendered
  // messages typesets (until then it shows as plain $…$ text).
  const [katexReady, setKatexReady] = useState(isChatKatexReady);
  useEffect(() => { ensureChatKatex().then(() => setKatexReady(true)); }, []);
  // Live tool activity for the current/just-finished turn (session-only; not persisted).
  const [toolEvents, setToolEvents] = useState<ToolUIEvent[]>([]);
  // Which retrieved passages the LAST answer quoted. Derived from n-gram overlap (kernel `groundedIn`),
  // never from the model claiming it — so this cannot be a fabricated citation. It proves a quote, not
  // that the passage answered the question (see kernel/citation.ts).
  const [groundingNote, setGroundingNote] = useState<CitationNote | null>(null);
  // Follow-up chips for the just-finished turn. Derived deterministically from turn state — no model
  // call — so they cost nothing on a CPU box. Cleared on send.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // A pending ask_user.question — renders inline buttons and suspends the turn until a pick.
  const [askPending, setAskPending] = useState<{ question: string; choices: AskChoice[] } | null>(null);
  const askResolverRef = useRef<((value: string) => void) | null>(null);
  // Words typed into a card that the kernel handed back as the child's own next message (a safety
  // disclosure, TutorTurnResult.cardMessage), saved by the turn that ended at the card. The effect below
  // asks for the reply to them once that turn has finished, so the reply reads that turn's saved reply as
  // history.
  const [cardMessage, setCardMessage] = useState<CardMessage | null>(null);
  // Choices the last reply wrote as a list instead of calling ask_user.question (kernel replyChoices.ts).
  // Shown as the same buttons; a pick is sent as the student's next message. Cleared on send.
  const [replyChoices, setReplyChoices] = useState<ReplyChoices | null>(null);
  // A pending permission "ask" — renders an Allow / Don't allow card and suspends until the choice.
  const [confirmPending, setConfirmPending] = useState<{ toolName: string; summary: string } | null>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The post-turn knowledge reflection still running, stopped when the next turn starts or the chat closes:
  // on a CPU-only PC Ollama answers one request at a time, so it would hold the learner's next reply.
  const reflectionRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Which thread's messages are currently in state. Lifting threadId to a PROP created a second
  // writer to `messages` — this effect and the send path — and on the first send of a new thread they
  // race: onThreadCreated changes the prop mid-send, so the effect's load and the send's append are
  // both in flight. Whichever resolves last wins, and both orderings are wrong. If the load lands
  // first, the append duplicates the message it already contains (a React duplicate-key error). If it
  // lands second, it resolves with the rows from BEFORE the insert and silently wipes the message the
  // student just sent.
  //
  // The send path claims the thread it creates, so this effect skips a thread already in state.
  // The rules (and #270's StrictMode re-run) live in lib/thread-transcript.ts.
  const transcriptRef = useRef<TranscriptLoader | null>(null);
  transcriptRef.current ??= transcriptLoader(getChatMessages, (msgs) => {
    setMessages(msgs);
    setSuggestions([]);
    setReplyChoices(null);
    setGroundingNote(null);
    setToolEvents([]);
    // An error belongs to the conversation it happened in: opening another one, or a new one, clears it.
    setChatError("");
  });
  const transcript = transcriptRef.current;

  // The turn in flight and the thread it belongs to (null until a new conversation's thread exists).
  // A turn only touches the shared streaming state while it is the one here; see turn-thread.ts.
  const turnOwnerRef = useRef<{ thread: string | null } | null>(null);
  // A send still setting up (creating the thread, saving the message, probing the model) before
  // `streaming` is set. Without it, a second Enter in that window took over the turn and the first
  // question got no reply. Released by the turn that set it, whether setup finishes or throws.
  const settingUpRef = useRef<object | null>(null);

  // Read aloud (#243): a speaker button on every tutor reply, and for K-2 learners each new reply
  // reads itself unless they turned that off (grade.ts autoReadAloud).
  const readAloud = useReadAloud();
  const [autoReadChoice, setAutoReadChoice] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    getReadAloudAuto(learnerId).then((v) => { if (alive) setAutoReadChoice(v); }).catch(() => {});
    return () => { alive = false; };
  }, [learnerId]);
  const autoRead = autoReadAloud(grade, autoReadChoice);
  // Switching conversations stops the voice; so does leaving the chat (useReadAloud's unmount).
  const stopReading = readAloud.stop;
  useEffect(() => { stopReading(); }, [threadId, stopReading]);

  // Messages follow whichever thread the rail has open. A null thread is a not-yet-created
  // conversation (see the send path) and correctly shows an empty transcript.
  useEffect(() => transcript.open(threadId), [threadId, transcript]);

  // Keep the local persona in sync if the course (or its persisted sprite) changes under us.
  useEffect(() => { setSpriteId(course.sprite_id ?? null); }, [course.id, course.sprite_id]);

  // `null` clears the persona entirely — the tutor falls back to the course's generated identity and
  // no character voice is injected at all. The whole data path already supported null
  // (setCourseSprite, resolvePersona, buildSystemPrompt); only the picker had no way to say it, so a
  // student who did not want a character was stuck with one.
  const switchPersona = async (id: string | null) => {
    setSpriteId(id);
    setPersonaPickerOpen(false);
    try { await setCourseSprite(courseId, id); } catch (e) { console.error("[persona] failed to persist sprite", e); }
  };

  // Deep-link from OverviewTab / NextStepCard: pre-fill the input with a topic
  // prompt and let the user edit or send. Consumed once.
  useEffect(() => {
    if (!seedTopic) return;
    setInput(`Help me with ${seedTopic}.`);
    inputRef.current?.focus();
    onSeedConsumed?.();
  }, [seedTopic, onSeedConsumed]);

  // Abort any in-flight stream on unmount or when level/course changes.
  //
  // Resolving the two suspended-turn promises is NOT optional (#86): a turn parked inside
  // ask_user.question or a permission confirm is awaiting a Promise that only a click resolves.
  // Aborting the controller does not settle it, so navigating away with a card on screen left the
  // generator awaiting forever — a leaked turn holding its whole message array. The explicit Stop
  // handler already did this; unmount did not.
  //
  // Releasing the turn is not optional either: a turn still setting up (saving the message, probing the
  // model) has no controller yet, so the abort above misses it. With the owner gone it stops at its next
  // check instead of running a reply nobody sees.
  useEffect(() => {
    return () => {
      turnOwnerRef.current = null;
      abortRef.current?.abort();
      reflectionRef.current?.abort();
      reflectionRef.current = null;
      askResolverRef.current?.("");
      askResolverRef.current = null;
      confirmResolverRef.current?.(false);
      confirmResolverRef.current = null;
    };
  }, [courseId, level]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, toolEvents, askPending, confirmPending]);

  const cancelStream = () => {
    if (readAloud.speakingId === ASK_CARD_READ || readAloud.speakingId === CONFIRM_CARD_READ) readAloud.stop();
    abortRef.current?.abort();
    abortRef.current = null;
    // Unblock any pending ask_user so the suspended turn can unwind and stop.
    askResolverRef.current?.("");
    askResolverRef.current = null;
    setAskPending(null);
    // Unblock any pending permission confirm as a decline so the suspended turn can unwind.
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = null;
    setConfirmPending(null);
    setStreaming(false);
    setStreamingText("");
  };

  // Opening another conversation mid-reply abandons the reply, exactly like Stop (#246). It is still
  // saved, interrupted, to its own thread; it never lands in or reads aloud over the one now shown.
  useEffect(() => {
    if (!threadSwitchAbortsTurn(turnOwnerRef.current?.thread, threadId)) return;
    turnOwnerRef.current = null;
    cancelStream();
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps -- cancelStream only touches refs and setters

  const handleAskChoice = (value: string) => {
    if (readAloud.speakingId === ASK_CARD_READ) readAloud.stop();
    setAskPending(null);
    const resolve = askResolverRef.current;
    askResolverRef.current = null;
    resolve?.(value);
  };

  const handleConfirm = (ok: boolean) => {
    if (readAloud.speakingId === CONFIRM_CARD_READ) readAloud.stop();
    setConfirmPending(null);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(ok);
  };

  const pickSuggestion = (s: Suggestion) => { setInput(s.message); setPendingMode(s.mode ?? null); inputRef.current?.focus(); };

  // `picked` is a reply-choice button's text, sent as is; otherwise the input box is sent. While a
  // question card waits, the box stays usable and what the child types answers the card: a card whose
  // buttons don't fit what they want to say is never a dead end (click test 2026-11-14). Unless it reads
  // as a safety disclosure: the kernel hands those words back (TutorTurnResult.cardMessage), runTurn
  // saves them as the child's own message, and the effect below passes that message as `saved`, which
  // runs the reply to it without saving it again.
  const sendMessage = async (picked?: string, saved?: ChatMessage) => {
    if (askPending && picked === undefined) {
      const typed = input.trim();
      if (!typed) return;
      setInput("");
      handleAskChoice(typed);
      return;
    }
    const text = picked ?? input;
    if (!text.trim() || streaming || settingUpRef.current) return;
    const setupToken = {};
    settingUpRef.current = setupToken;
    try {
      await runTurn(setupToken, text, picked === undefined, saved);
    } finally {
      if (settingUpRef.current === setupToken) settingUpRef.current = null;
    }
  };

  // The reply to a card's typed words, already saved as the child's message (so the safety notice shows
  // under it), run as an ordinary turn (the safety rules in the system prompt, no grading). If the child
  // opened another conversation first, the words stay saved in their own thread, with no reply.
  useEffect(() => {
    if (!cardMessage || streaming || settingUpRef.current) return;
    setCardMessage(null);
    if (cardMessage.thread === threadId) void sendMessage(cardMessage.saved.content, cardMessage.saved);
  }, [cardMessage, streaming, threadId]); // eslint-disable-line react-hooks/exhaustive-deps -- sendMessage is this render's, which holds the finished turn's messages

  // `saved`: the child's message is already saved (card words handed back by the kernel), so only the
  // reply runs.
  const runTurn = async (setupToken: object, text: string, fromInput: boolean, saved?: ChatMessage) => {
    reflectionRef.current?.abort();
    reflectionRef.current = null;
    setChatError("");

    const userText = text.trim();
    if (fromInput) setInput("");
    setReplyChoices(null);
    readAloud.stop();
    const owner: { thread: string | null } = { thread: threadId };
    turnOwnerRef.current = owner;

    // The thread is created HERE, on first send, not on mount — so opening a level and leaving does
    // not litter the list with empty conversations. The title comes from this first message via a
    // pure function, deliberately not a model call: titling is not worth 3-8s on a CPU box.
    // A message that could not be saved (a full disk, the database busy past its wait) is not sent:
    // its words go back in the box, and the chat says so plainly.
    let activeThread = threadId;
    let userMsg: ChatMessage;
    try {
      if (!activeThread) {
        const t = await createChatThread(courseId, level, deriveThreadTitle(userText));
        activeThread = t.id;
        // Record it BEFORE the rail opens it, so opening it does not count as a switch away.
        owner.thread = t.id;
        // Claim it BEFORE telling the parent: the prop change that follows would otherwise trigger a
        // reload that races this send. We already hold this thread's messages — there are none.
        // Skipped if the student opened another thread while this one was being created.
        if (turnOwnerRef.current === owner) {
          transcript.claim(t.id);
          onThreadCreated(t.id);
        }
      }
      userMsg = saved ?? await saveChatMessage(courseId, "user", userText, level, activeThread);
    } catch (e) {
      log.error("ChatTab", "saving the student's message failed", e);
      if (turnOwnerRef.current === owner) {
        turnOwnerRef.current = null;
        setInput((cur) => (cur.trim() ? cur : userText));
        setChatError(messageNotSaved(e));
      }
      return;
    }
    const thread = activeThread;
    const shown = () => turnIsShown(thread, transcript.shown());

    // `history` is the conversation from before this send (`messages` may already show a `saved` one).
    const history = saved ? messages.filter((m) => m.id !== saved.id) : messages;
    const studentAttempted = hasTriedOpenQuestion([...history, { role: "user", content: userText }]);
    if (shown()) setMessages((prev) => appendUnique(prev, userMsg));
    void touchChatThread(activeThread).catch(() => {});
    onThreadActivity();
    // The chat closed, or another thread opened, while the message was being saved: it stays saved.
    if (turnOwnerRef.current !== owner) return;

    // Build system prompt — with fallback if instructions not yet generated. The kernel appends
    // the <tools> manifest to this when it offers tools; a no-tool turn leaves it untouched.
    let instructions: Awaited<ReturnType<typeof getTutorInstructions>>;
    let knowledgeSummary: string;
    try {
      instructions = await getTutorInstructions(courseId);
      knowledgeSummary = await getKnowledgeSummary(courseId);
    } catch (e) {
      log.error("ChatTab", "reading the tutor's instructions failed", e);
      if (turnOwnerRef.current === owner) {
        turnOwnerRef.current = null;
        setChatError(friendlyError(e));
      }
      return;
    }
    // The window this turn runs in (store.ts getOllamaNumCtx): the same num_ctx every Ollama call for
    // this model sends, so a course build or quiz grading never reloads the model chat just used.
    // Before #86 nothing sent num_ctx at all, so Ollama silently used its own default and dropped the
    // front of the prompt — the system message and the tools manifest — with no error.
    const { config, profile } = await getChatTurnConfig();
    const { contextTokens } = config;
    const modelTier = profile.tier;
    // The mode skill and the course's domain skill, and the <skill_bundle> text they add. The rules
    // live in kernel/chatSkills.ts so the k12-flow eval and the tests build the turn the same way.
    const mode = chatTurnMode(pendingMode, [...history, { role: "user", content: userText }]);
    const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills(mode, course.topic, modelTier, profile.supportsTools, currentSyllabus);
    if (import.meta.env.DEV && !profile.supportsTools && !toolsSuppressedLogged.has(config.model)) {
      toolsSuppressedLogged.add(config.model);
      console.info(`[OpenEdu:tools] ${config.model} reports no tool support — offering no tools or domain skill, grounded chat only`);
    }
    // Phase 4b: the chosen persona (WHO) overrides only the identity slot; mode/domain stay as-is.
    const persona = resolvePersona(spriteId) ?? null;
    const systemPrompt = buildSystemPrompt(
      instructions,
      currentSyllabus,
      course.current_level,
      course.topic,
      skillSuffix,
      knowledgeSummary || undefined,
      personaIdentityLayer(persona),
      gradePromptLayer(grade, userText),
    );

    // Only include system message if it has content
    const llmMessages = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
      ...history.map((m) => ({ role: m.role as string, content: m.content })),
      { role: "user", content: userText },
    ];

    // The student opened another thread while this turn was being set up: their message is saved to
    // its own thread above; don't start a reply nobody is looking at.
    if (turnOwnerRef.current !== owner) return;

    const controller = new AbortController();
    abortRef.current = controller;
    // `streaming` guards sends from here on.
    if (settingUpRef.current === setupToken) settingUpRef.current = null;
    setStreaming(true);
    setStreamingText("");
    setReplyLanded(false);
    setToolEvents([]);
    setGroundingNote(null);
    setSuggestions([]);
    setPendingMode(null); // consumed by this turn

    // A card holds the turn open, so the reply is not saved (or auto-read) until it is answered. For K-2
    // (autoRead) each card is read as it appears, with the text streamed before it that was not read
    // yet; the saved reply then reads on from where the cards left off (speech.ts unreadText).
    // On a safety disclosure the notice under the learner's message, with its numbers, is read first,
    // ahead of the first card or the reply (speech.ts speechAfterNotice), and only once.
    let shownText = "";
    let readText = "";
    let noticeUnread = autoRead && isSafetyDisclosure(userText, grade) ? SAFETY_NOTICE : "";
    const speakTurn = (id: string, text: string) => {
      readAloud.speak(id, speechAfterNotice(noticeUnread, text));
      noticeUnread = "";
    };
    const readCard = (id: string, question: string, choices: string[]) => {
      if (!autoRead || turnOwnerRef.current !== owner) return;
      speakTurn(id, chatCardSpeech(unreadText(shownText, readText), question, choices));
      readText = shownText;
    };

    const turn: TutorTurn = {
      messages: llmMessages,
      config,
      retrieval: await getRetrievalMode(),
      // What tells a safety disclosure from an answer in the kernel: the same grade as the notice below.
      grade,
      onText: (chunk) => { shownText += chunk; if (turnOwnerRef.current === owner) setStreamingText((prev) => prev + chunk); },
      onToolEvent: (ev) => { if (turnOwnerRef.current === owner) setToolEvents((prev) => [...prev.filter((e) => e.id !== ev.id), ev]); },
    };

    const ctx: ToolContext = {
      courseId,
      level,
      syllabus: currentSyllabus,
      modelTier,
      contextTokens,
      permissionMode: "default", // Phase 2: rules live in permissions.json; "default" asks before writes
      config,
      abort: controller.signal,
      activeSkill,
      domainSkill,
      supportsTools: profile.supportsTools,
      grade,
      // A turn no longer here (the chat closed, or another thread opened) gets no card: nobody could
      // answer it, and the turn would wait forever. It unwinds as if Stop was pressed.
      askUser: (question, choices) =>
        new Promise<string>((resolve) => {
          if (turnOwnerRef.current !== owner || controller.signal.aborted) { resolve(""); return; }
          askResolverRef.current = resolve;
          setAskPending({ question, choices });
          // The question as the card shows it: none when the text above already ends on it.
          readCard(ASK_CARD_READ, repeatsQuestion(shownText, question) ? "" : question, choices.map((c) => c.label));
        }),
      confirmTool: (toolName, summary) =>
        new Promise<boolean>((resolve) => {
          if (turnOwnerRef.current !== owner || controller.signal.aborted) { resolve(false); return; }
          confirmResolverRef.current = resolve;
          setConfirmPending({ toolName, summary });
          readCard(CONFIRM_CARD_READ, [confirmCardQuestion(toolName), summary].join("\n\n"), [CONFIRM_CHOICES.yes, CONFIRM_CHOICES.no]);
        }),
    };

    try {
      const result = await tutorEngine.run(turn, ctx);
      // The mark is saved whatever happens to the reply, so reload even after a thread switch.
      if (result.toolCalls.some((c) => c.name === "progress.mark_mastered" && c.ok)) onProgressChanged?.();
      // Three different things, previously collapsed into one flag. "abandoned" means the student
      // stopped it or the stream died; "truncated" means the model ran out of room mid-sentence but
      // what it did say is usable. Only the first should suppress follow-ups.
      const abandoned = result.stopReason === "aborted" || result.stopReason === "stalled";
      const truncated = result.stopReason === "length";
      const partial = abandoned || truncated;
      // persistedReply adds a marker to an interrupted reply rather than saving it as a finished answer.
      const persisted = persistedReply(result.text, result.stopReason);
      if (persisted !== null) {
        // Saved to the turn's own thread; shown and read aloud only per turnLanding (#246).
        const assistantMsg = await saveChatMessage(courseId, "assistant", persisted, level, activeThread);
        if (result.dictionaryShown) dictionaryCards.set(assistantMsg.id, dictionaryCard(result.dictionaryShown));
        const landing = turnLanding({
          turnThread: thread,
          shownThread: transcript.shown(),
          interrupted: abandoned || controller.signal.aborted,
          autoRead,
        });
        if (landing.show) {
          setMessages((prev) => appendUnique(prev, assistantMsg));
          if (turnOwnerRef.current === owner) setReplyLanded(true);
        }
        if (landing.speak) speakTurn(assistantMsg.id, unreadText(persisted, readText));
        // Post-turn knowledge reflection — non-blocking, best-effort. Skipped when
        // knowledge.update_map already wrote this turn so there's exactly one writer, and skipped on
        // a partial turn: reflecting over a truncated fragment writes bad knowledge permanently. Nor on a
        // safety-disclosure turn (result.disclosure): the reflection would write the learner's words into
        // the course's knowledge files, which every later tutor prompt for the course reads.
        // Stopped when the next turn starts or the chat closes (reflectionRef), so it never delays a reply.
        if (!result.usedKnowledgeUpdate && !partial && !result.disclosure) {
          const reflection = new AbortController();
          reflectionRef.current = reflection;
          updateKnowledgeFiles(courseId, userText, result.text, config, "default", reflection.signal)
            .catch(() => {})
            .finally(() => { if (reflectionRef.current === reflection) reflectionRef.current = null; });
        }
      }
      // The turn ended at a card whose typed words go next as the child's own message (no chips under it).
      // Saved here, straight after the reply and before anything that can drop them: a thread switch, or
      // the chat closing (another tab, course or level), which loses the state the reply waits in. A lost
      // disclosure is the worst thing to lose. Only the reply to them is left to the effect above.
      let handedBack: CardMessage | null = null;
      if (result.cardMessage) {
        const cardMsg = await saveChatMessage(courseId, "user", result.cardMessage, level, activeThread);
        if (shown()) setMessages((prev) => appendUnique(prev, cardMsg));
        handedBack = { thread, saved: cardMsg };
      }
      // Abandoned by a thread switch: its chips and notices belong to a thread no longer shown.
      if (turnOwnerRef.current !== owner) return;
      if (handedBack) { setCardMessage(handedBack); return; }
      // The honesty surface (#90, and Tate's Q2). Three distinct states, and the middle one is the
      // whole point: retrieval fired and the answer did NOT use it. Hiding that case is exactly how a
      // tutor ends up looking like it read your notes when it didn't.
      setGroundingNote(citationNote(result.grounding.hits, result.usedHits, result.grounding.trace));
      // Follow-up chips. `countDueFlashcards` is a cheap indexed read of the due cards and the only I/O here; if it
      // fails the chips just lose one option rather than the turn losing its suggestions.
      const due = await countDueFlashcards(courseId, new Date().toISOString(), grade).catch(() => 0);
      setSuggestions(suggestFollowUps({
        answer: result.text,
        syllabus: currentSyllabus,
        hits: result.grounding.hits,
        usedHits: result.usedHits,
        dueFlashcards: due,
        abandoned,
        truncated,
        studentAttempted,
      }));
      setReplyChoices(result.replyChoices);

      if (result.stopReason === "stalled") {
        setChatError(STALLED_TURN);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel/i.test(msg) && turnOwnerRef.current === owner) {
        log.error("ChatTab", "turn failed", msg);
        setChatError(friendlyError(msg));
      }
    } finally {
      // Only a turn still here resets the shared state: a switch already reset it (cancelStream), and
      // a newer turn may be streaming by the time this one unwinds.
      if (turnOwnerRef.current === owner) {
        turnOwnerRef.current = null;
        setStreamingText("");
        setStreaming(false);
        setReplyLanded(false);
        abortRef.current = null;
        setAskPending(null);
        askResolverRef.current = null;
        setConfirmPending(null);
        confirmResolverRef.current = null;
      }
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Persona header (Phase 4b) — active tutor's headshot + name; click to switch mid-course. */}
      <div className="relative flex items-center px-4 py-2 border-b border-[var(--rule)] bg-panel">
        <button
          type="button"
          onClick={() => setPersonaPickerOpen((o) => !o)}
          className="flex items-center gap-2 group"
          title="Switch tutor persona"
        >
          <CompanionSprite spriteId={spriteId} size={32} />
          <span className="text-xs text-[var(--ink-dim)] group-hover:text-phosphor-bright">
            {getSpritePersona(spriteId)?.displayName ?? "Choose a tutor"}
          </span>
          <span className="text-[var(--ink-faint)] text-xs">▾</span>
        </button>
        {/* Always on screen, from the first message on: the tutor is an AI, whatever persona it wears (ai-notice.ts). */}
        <span className="ml-auto pl-3 text-xs text-[var(--ink-dim)] text-right">{AI_DISCLOSURE}</span>
        {personaPickerOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPersonaPickerOpen(false)} />
            <div className="absolute left-3 top-full z-20 mt-1 w-64 rounded-lg border border-[var(--rule)] bg-panel-lite shadow-xl p-1.5">
              <button
                type="button"
                onClick={() => switchPersona(null)}
                className={`flex items-start gap-2 w-full text-left p-1.5 rounded-md hover:bg-panel ${spriteId === null ? "bg-panel" : ""}`}
              >
                <span className="w-9 h-9 shrink-0 rounded-md border border-[var(--rule)] bg-lcd flex items-center justify-center text-[var(--ink-faint)] text-xs">—</span>
                <span className="min-w-0">
                  <span className="block text-xs text-phosphor-bright">No persona</span>
                  <span className="block text-xs text-[var(--ink-faint)] leading-snug">Just the tutor. No character voice.</span>
                </span>
              </button>
              {SPRITE_PERSONAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchPersona(p.id)}
                  className={`flex items-start gap-2 w-full text-left p-1.5 rounded-md hover:bg-panel ${spriteId === p.id ? "bg-panel" : ""}`}
                >
                  <CompanionSprite spriteId={p.id} size={36} />
                  <span className="min-w-0">
                    <span className="block text-xs text-phosphor-bright">{p.displayName}</span>
                    <span className="block text-xs text-[var(--ink-faint)] leading-snug">{p.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {/* Messages */}
      <div className={`flex-1 overflow-y-auto p-6 space-y-4 ${isEarlyReader(grade) ? "chat-text-large" : ""}`}>
        {messages.length === 0 && !streaming && (
          <div className="text-center text-[var(--ink-faint)] py-12">
            <p className="text-lg mb-2">Start chatting with your tutor</p>
            <p className="text-sm">
              Ask about <span className="text-phosphor-ink">{course.topic}</span> and your tutor will guide you through the curriculum.
            </p>
            {!currentSyllabus && (
              <p className="text-xs text-warning mt-3">
                No syllabus loaded yet — your tutor will still help, but check the Syllabus tab once course creation finishes.
              </p>
            )}
          </div>
        )}
        {isHealthTopic(course.topic) && (
          <div className="p-3 rounded-lg border border-warning/40 border-l-4 border-l-warning bg-warning-tint text-xs text-ink leading-relaxed">
            {HEALTH_NOTICE}
          </div>
        )}
        {messages.map((msg) => {
          const card = msg.role === "assistant" ? dictionaryCards.get(msg.id) : undefined;
          const cardId = `dictionary:${msg.id}`;
          const safetyId = `safety:${msg.id}`;
          return (
            <div key={msg.id} className="space-y-2">
              <MessageBubble
                message={msg}
                reading={readAloud.speakingId === msg.id}
                katexReady={katexReady}
                onReadAloud={readAloud.supported ? readAloud.toggle : undefined}
              />
              {/* A self-harm or abuse disclosure, or with a K-12 grade set a strong pregnancy self-disclosure, gets a
                  fixed notice under it, shown as soon as the message is;
                  the tutor turn still runs (child-safety.ts). Code-matched, never a model call. A .chat-msg, so
                  K-2's larger chat text applies, with a speaker button so a child who cannot read it can hear it. */}
              {msg.role === "user" && isSafetyDisclosure(msg.content, grade) && (
                <div role="note" className="chat-msg flex items-start gap-3 p-3 rounded-lg border border-warning/40 border-l-4 border-l-warning bg-warning-tint text-sm text-ink leading-relaxed">
                  <p className="flex-1">{SAFETY_NOTICE}</p>
                  {readAloud.supported && (
                    <button
                      type="button"
                      className="speak-btn"
                      onClick={() => readAloud.toggle(safetyId, SAFETY_NOTICE)}
                      aria-label={readAloud.speakingId === safetyId ? "Stop reading" : "Read aloud"}
                      aria-pressed={readAloud.speakingId === safetyId}
                      title={readAloud.speakingId === safetyId ? "Stop reading" : "Read aloud"}
                    >
                      {readAloud.speakingId === safetyId ? (
                        <IconMediaStop size={16} className="scale-[0.65]" />
                      ) : (
                        <IconVolumeUp size={18} />
                      )}
                    </button>
                  )}
                </div>
              )}
              {card && (
                <DictionaryCard
                  card={card}
                  startsOpen={cardStartsOpen(grade)}
                  reading={readAloud.speakingId === cardId}
                  onReadAloud={readAloud.supported ? () => readAloud.toggle(cardId, cardSpeech(card)) : undefined}
                />
              )}
            </div>
          );
        })}
        {/* No empty "Thinking..." bubble above a question card or an "Is that okay?" card: the card is what
            the tutor is saying, and the turn waits on the learner's tap, not on the model. */}
        {streaming && !replyLanded && !((askPending || confirmPending) && !streamingText) && (
          <div className="flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
              AI
            </span>
            <div className="chat-msg flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
              {streamingText
                ? (
                  <ReplyProse text={streamingText} streaming katexReady={katexReady}>
                    <span className="inline-block w-1.5 h-4 bg-phosphor-ink animate-pulse ml-0.5 align-middle" />
                  </ReplyProse>
                )
                : (
                  <span className="text-[var(--ink-faint)] italic">
                    Thinking...
                    <span className="inline-block w-1.5 h-4 bg-phosphor-ink animate-pulse ml-0.5 align-middle" />
                  </span>
                )
              }
            </div>
          </div>
        )}
        {toolEvents.length > 0 && <ToolActivity events={toolEvents} onOpenResource={onOpenResource} onOpenReview={onOpenReview} />}
        {!streaming && groundingNote && <GroundingNote note={groundingNote} />}
        {!streaming && !askPending && !confirmPending && !replyChoices && suggestions.length > 0 && (
          <SuggestionChips suggestions={suggestions} onPick={pickSuggestion} />
        )}
        {askPending && (
          <AskUserChoices
            question={repeatsQuestion(streamingText, askPending.question) ? "" : askPending.question}
            choices={askPending.choices}
            onPick={handleAskChoice}
            onTypeOwn={() => inputRef.current?.focus()}
            reading={readAloud.speakingId === ASK_CARD_READ}
            // The button always reads the question, even when only the text above shows it.
            onReadAloud={readAloud.supported ? () => readAloud.toggle(ASK_CARD_READ, chatCardSpeech("", askPending.question, askPending.choices.map((c) => c.label))) : undefined}
          />
        )}
        {!streaming && !askPending && !confirmPending && replyChoices && (
          <>
            <AskUserChoices
              question={repeatsQuestion(messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1].content : "", replyChoices.question) ? "" : replyChoices.question}
              choices={replyChoices.choices}
              onPick={(value) => void sendMessage(value)}
              reading={readAloud.speakingId === ASK_CARD_READ}
              onReadAloud={readAloud.supported ? () => readAloud.toggle(ASK_CARD_READ, chatCardSpeech("", replyChoices.question, replyChoices.choices.map((c) => c.label))) : undefined}
            />
            {/* Beside the buttons, only the stuck chips and due cards (chipsBesideChoices). */}
            {chipsBesideChoices(suggestions).length > 0 && (
              <SuggestionChips suggestions={chipsBesideChoices(suggestions)} onPick={pickSuggestion} />
            )}
          </>
        )}
        {confirmPending && (
          <ConfirmToolCard
            toolName={confirmPending.toolName}
            summary={confirmPending.summary}
            onChoose={handleConfirm}
            reading={readAloud.speakingId === CONFIRM_CARD_READ}
            onReadAloud={readAloud.supported
              ? () => readAloud.toggle(CONFIRM_CARD_READ, chatCardSpeech("", [confirmCardQuestion(confirmPending.toolName), confirmPending.summary].join("\n\n"), [CONFIRM_CHOICES.yes, CONFIRM_CHOICES.no]))
              : undefined}
          />
        )}
        {chatError && (
          <div className="mx-2 p-3 rounded-lg bg-danger-tint border border-danger/30 text-sm text-danger">
            <span className="font-medium">Error:</span> {chatError}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--rule)] bg-panel">
        {/* A chip that carried a teaching mode says so, and can be taken back off. Visible because an
            invisible mode is indistinguishable from the tutor behaving oddly. */}
        {pendingMode && (
          <div className="flex max-w-3xl mx-auto mb-2.5">
            <button
              type="button"
              onClick={() => setPendingMode(null)}
              title="Ask normally instead"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[rgb(var(--phosphor-rgb)/0.14)] text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
            >
              <span>{TUTOR_MODES.find((m) => m.id === pendingMode)?.icon}</span>
              <span>{TUTOR_MODES.find((m) => m.id === pendingMode)?.label}</span>
              <span className="text-[var(--ink-faint)]">✕</span>
            </button>
          </div>
        )}
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={askPending ? "Or type your own answer..." : "Ask your tutor anything..."}
            aria-label="Message to your tutor"
            className="flex-1 px-4 py-3 rounded-xl bg-panel-lite border border-[var(--rule)] text-ink placeholder-[var(--ink-faint)] text-sm focus:outline-none focus:border-phosphor"
            disabled={streaming && !askPending}
          />
          {streaming && !askPending ? (
            <button
              onClick={cancelStream}
              title="Stop generating"
              aria-label="Stop generating"
              className="px-4 py-3 rounded-xl bg-lcd hover:bg-danger-tint text-[var(--ink-faint)] hover:text-danger transition-colors"
            >
              <IconMediaStop size={20} className="scale-[0.65]" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              aria-label="Send"
              title="Send"
              className="px-4 py-3 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <IconPaperPlane size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// A transcript must never contain the same message id twice. Enforced at the one place that appends
// rather than trusted, because the failure is silent in production (React only complains in dev) and
// what the student sees is their own question rendered twice.
function appendUnique(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
}

// A tutor reply's prose. A ```mermaid fence in it (one the model wrote, or the one the kernel shows for a
// diagram.render call, kernel/drawnCards.ts) is drawn through MermaidBlock instead of shown as code
// (mermaid-source.ts); a fence still streaming shows a placeholder.
// A reply without one renders exactly as before. A saved reply is shown through displayReplyText, so
// one saved before the kernel filtered tool-call text never shows it either.
// The HTML (marked + KaTeX + DOMPurify) is built only when the text changes or KaTeX finishes loading,
// so a re-render with the same reply reuses it.
function ReplyProse({ text: raw, streaming = false, katexReady, children }: { text: string; streaming?: boolean; katexReady: boolean; children?: React.ReactNode }) {
  const text = useMemo(() => (streaming ? raw : displayReplyText(raw)), [raw, streaming]);
  const segments = useMemo(() => splitReplyDiagrams(text), [text]);
  // katexReady is read only as a dependency: renderChatMarkdown typesets math once KaTeX has loaded.
  const html = useMemo(
    () => segments.map((s) => (s.kind === "markdown" ? renderChatMarkdown(s.text) : "")),
    [segments, katexReady],
  );
  if (!streaming && segments.length === 1 && segments[0].kind === "markdown") {
    return (
      <div
        className="note-prose"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html[0] }}
      />
    );
  }
  return (
    <div className="note-prose">
      {segments.map((s, i) => s.kind === "markdown"
        // eslint-disable-next-line react/no-danger
        ? <div key={i} dangerouslySetInnerHTML={{ __html: html[i] }} />
        : s.closed || !streaming
          ? <div key={i} className="my-2"><MermaidBlock code={s.code} /></div>
          : <div key={i} className="lcd rounded-lg px-3 py-2 my-2 text-sm text-[var(--ink-dim)]">drawing a diagram…</div>)}
      {children}
    </div>
  );
}

// `onReadAloud` is set when the webview can speak; tutor replies then get a speaker button that reads
// the reply (speech.ts speakableText) and, pressed again, stops.
// Memoized, and every prop is stable between tokens (the message objects, readAloud.toggle), so a
// streamed token re-renders only the streaming bubble, not every saved message in the thread.
const MessageBubble = memo(function MessageBubble({ message, reading, katexReady, onReadAloud }: {
  message: ChatMessage;
  reading: boolean;
  katexReady: boolean;
  onReadAloud?: (id: string, text: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
        isUser ? "bg-lcd text-[var(--ink-dim)]" : "bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright"
      }`}>
        {isUser ? "You" : "AI"}
      </span>
      <div className={`chat-msg max-w-[75%] p-3 rounded-xl text-sm leading-relaxed ${
        isUser ? "bg-[rgb(var(--phosphor-rgb)/0.10)] text-ink whitespace-pre-wrap" : "bg-panel text-ink"
      }`}>
        {isUser ? message.content : <ReplyProse text={message.content} katexReady={katexReady} />}
      </div>
      {!isUser && onReadAloud && (
        <button
          type="button"
          className="speak-btn self-end"
          onClick={() => onReadAloud(message.id, displayReplyText(message.content))}
          aria-label={reading ? "Stop reading" : "Read aloud"}
          aria-pressed={reading}
          title={reading ? "Stop reading" : "Read aloud"}
        >
          {reading ? (
            <IconMediaStop size={16} className="scale-[0.65]" />
          ) : (
            <IconVolumeUp size={18} />
          )}
        </button>
      )}
    </div>
  );
});

// Follow-up chips. Tapping one PREFILLS the input rather than sending immediately — the student can
// edit it first, and a mis-tap costs nothing. That is the difference between a suggestion and a
// button that spends 8 seconds of a CPU box's time on something you did not mean.
function SuggestionChips({ suggestions, onPick }: { suggestions: Suggestion[]; onPick: (s: Suggestion) => void }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 shrink-0" />
      <div className="flex-1 flex flex-wrap items-start gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s.message}
            type="button"
            onClick={() => onPick(s)}
            title={s.message}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] border border-[var(--rule)] bg-panel-lite text-[var(--ink-dim)] hover:border-phosphor/50 hover:text-phosphor-bright hover:bg-panel transition-colors"
          >
            <span className="text-[var(--ink-faint)]">↳</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Honest grounding readout (#90). Two states, both worth showing:
//   quoted     — the answer demonstrably reused these passages (n-gram overlap, not the model's word).
//                Worded as a quote, not a source: an honest "your notes don't say" that quotes the
//                note lands here too (kernel/citation.ts has the evidence).
//   ungrounded — passages WERE retrieved and the answer used none of them; the chip names only what
//                was searched (citation.ts ungroundedChipLabel)
// The second is the one that keeps the product honest. A tutor that silently drops it looks like it
// read the student's notes on every turn, which on a small model it very often did not.
function GroundingNote({ note }: { note: CitationNote }) {
  const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono border w-fit max-w-full";
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 shrink-0" />
      <div className="flex-1 flex flex-wrap items-start gap-1.5">
        {note.kind === "quoted" ? (
          note.titles.map((title) => (
            <span key={title} title={QUOTED_CHIP_TOOLTIP} className={`${base} bg-lcd border-phosphor/20 text-phosphor-ink`}>
              📓 {quotedChipLabel(title)}
            </span>
          ))
        ) : (
          <span
            title="Your material was searched, but this answer did not draw on it"
            className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-faint)]`}
          >
            ○ {note.label}
          </span>
        )}
      </div>
    </div>
  );
}

// Inline tool activity — progress chips that become result / error cards. Identity is the
// tool_call id, so a chip transitions in place. Session-only (not persisted in Phase 1).
function ToolActivity({ events, onOpenResource, onOpenReview }: { events: ToolUIEvent[]; onOpenResource?: (id: string) => void; onOpenReview?: () => void }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 shrink-0" />
      <div className="flex-1 flex flex-col items-start gap-1.5">
        {events.map((ev) => (
          <ToolChip key={ev.id} ev={ev} onOpenResource={onOpenResource} onOpenReview={onOpenReview} />
        ))}
      </div>
    </div>
  );
}

function ToolChip({ ev, onOpenResource, onOpenReview }: { ev: ToolUIEvent; onOpenResource?: (id: string) => void; onOpenReview?: () => void }) {
  const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono border w-fit max-w-full";
  // The error text is written for the model ("Call it again with arguments that match the schema"),
  // which already receives it and retries. A learner never needs to read it.
  if (ev.kind === "error") return null;
  if (ev.kind === "result") {
    // ask_user.question → nothing: the question and the answer are in the reply's text (askCard.ts).
    if (ev.name === "ask_user.question") return null;
    // notebook.search → a ✓ summary plus a "📓 Source: …" chip per cited document.
    if (ev.name === "notebook.search") {
      const results = (ev.value as { results?: NotebookSearchResult[] } | undefined)?.results ?? [];
      const sources: string[] = [];
      for (const r of results) if (!sources.includes(r.document_title)) sources.push(r.document_title);
      if (sources.length === 0) {
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>📓 Nothing in your notes about this</div>;
      }
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ Found {results.length} part{results.length === 1 ? "" : "s"} of your notes
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((title) => (
              <span key={title} title="Cited from your notebook" className={`${base} bg-lcd border-phosphor/20 text-phosphor-ink`}>
                📓 Source: {title}
              </span>
            ))}
          </div>
        </div>
      );
    }
    // library.search → a ✓ summary + a clickable "🔗 OpenEdu Library: …" citation chip. Clicking it
    // deep-links to the Resources tab and opens the cited card there — the full reference lives in that
    // tab, not in the chat stream. Mirrors the notebook.search citation shape.
    if (ev.name === "library.search") {
      const v = ev.value as { found?: boolean; id?: string; title?: string } | undefined;
      if (!v?.found || !v.title) {
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>🔗 {LIBRARY_NAME} — no matching reference</div>;
      }
      const clickable = !!(onOpenResource && v.id);
      const chipClass = `${base} bg-lcd border-phosphor/20 text-phosphor-ink ${clickable ? "cursor-pointer hover:border-phosphor/50 hover:text-phosphor-bright transition-colors" : ""}`;
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ Found something in the library
          </div>
          {clickable ? (
            <button type="button" onClick={() => onOpenResource!(v.id!)} title="Open in Resources" className={chipClass}>
              🔗 {LIBRARY_NAME}: {v.title}
            </button>
          ) : (
            <span title={`Cited from the ${LIBRARY_NAME}`} className={chipClass}>
              🔗 {LIBRARY_NAME}: {v.title}
            </span>
          )}
        </div>
      );
    }
    // library.lookup → a single deterministic record (or computed value). DATA results can deep-link to
    // a companion browse card (card_id); computed results (base/ASCII/conjugation) show a 🧮 chip, no link.
    if (ev.name === "library.lookup") {
      const v = ev.value as { found?: boolean; dataset?: string; title?: string; computed?: boolean; card_id?: string } | undefined;
      if (!v?.found || !v.title) {
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>🔎 {LIBRARY_NAME} — no matching record</div>;
      }
      const linkable = !!(onOpenResource && v.card_id);
      const lbl = `${v.computed ? "🧮 Computed" : `🔗 ${LIBRARY_NAME}`}: ${v.title}`;
      const cls = `${base} bg-lcd border-phosphor/20 text-phosphor-ink ${linkable ? "cursor-pointer hover:border-phosphor/50 hover:text-phosphor-bright transition-colors" : ""}`;
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ Looked it up in the library
          </div>
          {linkable ? (
            <button type="button" onClick={() => onOpenResource!(v.card_id!)} title="Open in Resources" className={cls}>{lbl}</button>
          ) : (
            <span title={`From the ${LIBRARY_NAME}`} className={cls}>{lbl}</span>
          )}
        </div>
      );
    }
    // flashcard.create → a "🃏 Card minted" confirmation chip.
    if (ev.name === "flashcard.create") {
      const v = ev.value as { front?: string } | undefined;
      return (
        <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
          🃏 Card minted{v?.front ? `: ${v.front.length > 48 ? v.front.slice(0, 48) + "…" : v.front}` : ""}
        </div>
      );
    }
    // flashcard.review_due → "N due → Review", clickable to deep-link into the Review tab.
    if (ev.name === "flashcard.review_due") {
      const n = (ev.value as { count?: number } | undefined)?.count ?? 0;
      const label = `🃏 ${n} card${n === 1 ? "" : "s"} due`;
      const cls = `${base} bg-lcd border-phosphor/20 text-phosphor-ink ${onOpenReview ? "cursor-pointer hover:border-phosphor/50 hover:text-phosphor-bright transition-colors" : ""}`;
      return onOpenReview ? (
        <button type="button" onClick={onOpenReview} title="Open the Review tab" className={cls}>{label} → Review</button>
      ) : (
        <span className={cls}>{label}</span>
      );
    }
    // notebook.ingest → "📓 Saved 'title' to your notes".
    if (ev.name === "notebook.ingest") {
      const v = ev.value as { title?: string } | undefined;
      return (
        <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
          📓 Saved{v?.title ? ` "${v.title}"` : ""} to your notes
        </div>
      );
    }
    // math.render / diagram.render → nothing: the kernel put the drawing in the reply's text, as a $$
    // block or a ```mermaid fence, where ReplyProse draws it and it is saved (kernel/drawnCards.ts).
    if (ev.name === "math.render" || ev.name === "diagram.render") return null;
    return <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>✓ {describeToolDone(ev.name, ev.value)}</div>;
  }
  return (
    <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>
      <span>{describeToolActivity(ev.name)}</span>
      <span className="inline-block w-1.5 h-3 bg-phosphor-ink animate-pulse" />
    </div>
  );
}

// The speaker button beside a chat card (the question card, the Allow / Don't allow card): reads the
// card and, pressed again, stops. Shown only when the webview can speak.
function CardSpeaker({ reading, onReadAloud }: { reading: boolean; onReadAloud?: () => void }) {
  if (!onReadAloud) return null;
  const label = reading ? "Stop reading" : "Read aloud";
  return (
    <button type="button" className="speak-btn self-end" onClick={onReadAloud} aria-label={label} aria-pressed={reading} title={label}>
      {reading ? <IconMediaStop size={16} className="scale-[0.65]" /> : <IconVolumeUp size={18} />}
    </button>
  );
}

// Permission "ask" (V2 §7) — Allow / Don't allow buttons that resolve the suspended turn. Reuses
// the ask_user choice-card look; declining feeds the model a "student declined" tool result.
// A .chat-msg, so K-2's larger chat text applies to it and to its buttons (.chat-choice).
function ConfirmToolCard({ toolName, summary, onChoose, reading = false, onReadAloud }: {
  toolName: string;
  summary: string;
  onChoose: (ok: boolean) => void;
  reading?: boolean;
  onReadAloud?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
        AI
      </span>
      <div className="chat-msg flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
        <p className="mb-1">{confirmCardQuestion(toolName)}</p>
        {summary && <p className="mb-2.5 text-[var(--ink-dim)]">{summary}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onChoose(true)}
            className="chat-choice px-3 py-1.5 rounded-lg text-sm font-medium bg-[rgb(var(--phosphor-rgb)/0.14)] text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
          >
            {CONFIRM_CHOICES.yes}
          </button>
          <button
            onClick={() => onChoose(false)}
            className="chat-choice px-3 py-1.5 rounded-lg text-sm font-medium bg-lcd text-[var(--ink-dim)] border border-[var(--rule)] hover:text-danger hover:border-danger/30 transition-colors"
          >
            {CONFIRM_CHOICES.no}
          </button>
        </div>
      </div>
      <CardSpeaker reading={reading} onReadAloud={onReadAloud} />
    </div>
  );
}

// ask_user.question — choice buttons that resolve the suspended turn on click. An empty `question` is
// one the reply above already ends on (repeatsQuestion), so only the buttons show. `onTypeOwn` adds a
// "Type my own answer" button that puts the cursor in the chat box, which answers the card.
// A .chat-msg, so K-2's larger chat text applies to it and to its buttons (.chat-choice).
function AskUserChoices({ question, choices, onPick, onTypeOwn, reading = false, onReadAloud }: {
  question: string;
  choices: AskChoice[];
  onPick: (value: string) => void;
  onTypeOwn?: () => void;
  reading?: boolean;
  onReadAloud?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
        AI
      </span>
      <div className="chat-msg flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
        {question && <p className="mb-2.5">{question}</p>}
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.value}
              onClick={() => onPick(c.value)}
              className="chat-choice px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[rgb(var(--phosphor-rgb)/0.14)] text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
            >
              {c.label}
            </button>
          ))}
          {onTypeOwn && (
            <button
              onClick={onTypeOwn}
              className="chat-choice px-3 py-1.5 rounded-lg text-[12px] font-medium bg-lcd text-[var(--ink-dim)] border border-[var(--rule)] hover:text-phosphor-bright hover:border-phosphor/40 transition-colors"
            >
              Type my own answer
            </button>
          )}
        </div>
      </div>
      <CardSpeaker reading={reading} onReadAloud={onReadAloud} />
    </div>
  );
}
