import { useState, useEffect, useRef, lazy, Suspense } from "react";
import type { Course, ChatMessage, Syllabus, NotebookSearchResult } from "../types";
import {
  getChatMessages, saveChatMessage, getTutorInstructions, setCourseSprite, countDueFlashcards,
  createChatThread, touchChatThread,
} from "../lib/db";
import { deriveThreadTitle } from "../lib/thread-title";
import { buildSystemPrompt } from "../lib/curriculum";
import { detectModelProfile } from "../lib/llm";
import { getChatConfig, getMaxContextTokens, getRetrievalMode } from "../lib/store";
import { getKnowledgeSummary, updateKnowledgeFiles } from "../lib/knowledge";
import { TUTOR_MODES, type TutorModeId } from "../lib/tutor-modes";
import { tutorEngine, skillBundleLayer, personaIdentityLayer, suggestFollowUps, type TutorTurn, type ToolUIEvent, type Suggestion } from "../lib/kernel";
import { resolveSkill, resolveDomainSkill, resolvePersona } from "../lib/skills";
import { SPRITE_PERSONAS, getSpritePersona } from "../lib/sprites/registry";
import type { ToolContext, AskChoice } from "../lib/tools";
import { renderChatMarkdown, ensureChatKatex } from "../lib/chat-markdown";
// MathBlock pulls KaTeX (~258 KB); lazy-load it so KaTeX leaves the eager bundle and only loads when
// a math.render card actually mounts.
const MathBlock = lazy(() => import("./MathBlock"));
import MermaidBlock from "./MermaidBlock";
import { CompanionSprite } from "./CompanionSprite";

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
}

export default function ChatTab({ courseId, course, level, currentSyllabus, seedTopic, onSeedConsumed, onOpenResource, onOpenReview, threadId, onThreadCreated, onThreadActivity }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [chatError, setChatError] = useState("");
  // The teaching mode for the NEXT turn. Set by tapping a chip that carries one; reset to the neutral
  // default after every send. There is no mode bar any more — asking the student to classify their
  // own intent before they have asked their question was the one thing they came for help with.
  // Persistent pedagogy lives on the persona instead (the WHO axis), so this is a per-turn override.
  const [pendingMode, setPendingMode] = useState<TutorModeId | null>(null);
  const activeMode: TutorModeId = pendingMode ?? "explain";
  // Phase 4b persona (WHO axis). Local mirror of course.sprite_id so a mid-course switch reflects
  // immediately; written through to the DB on switch. resolvePersona maps it to a persona skill.
  const [spriteId, setSpriteId] = useState<string | null>(course.sprite_id ?? null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  // KaTeX is lazy-loaded (chat-markdown). Kick it off on mount and re-render once ready so any inline
  // math in already-rendered messages typesets (until then it shows as plain $…$ text).
  const [, setKatexTick] = useState(0);
  useEffect(() => { ensureChatKatex().then(() => setKatexTick((t) => t + 1)); }, []);
  // Live tool activity for the current/just-finished turn (session-only; not persisted).
  const [toolEvents, setToolEvents] = useState<ToolUIEvent[]>([]);
  // Whether the LAST answer was actually grounded in retrieved material. Derived from n-gram overlap
  // (kernel `groundedIn`), never from the model claiming it — so this cannot be a fabricated citation.
  const [groundingNote, setGroundingNote] = useState<{ kind: "grounded"; titles: string[] } | { kind: "ungrounded" } | null>(null);
  // Follow-up chips for the just-finished turn. Derived deterministically from turn state — no model
  // call — so they cost nothing on a CPU box. Cleared on send.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // A pending ask_user.question — renders inline buttons and suspends the turn until a pick.
  const [askPending, setAskPending] = useState<{ question: string; choices: AskChoice[] } | null>(null);
  const askResolverRef = useRef<((value: string) => void) | null>(null);
  // A pending permission "ask" — renders an Allow / Don't allow card and suspends until the choice.
  const [confirmPending, setConfirmPending] = useState<{ toolName: string; summary: string } | null>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Messages follow whichever thread the rail has open. A null thread is a not-yet-created
  // conversation (see the send path) and correctly shows an empty transcript.
  useEffect(() => {
    let alive = true;
    (async () => {
      const msgs = threadId ? await getChatMessages(threadId) : [];
      if (!alive) return;
      setMessages(msgs);
      setSuggestions([]);
      setGroundingNote(null);
      setToolEvents([]);
    })();
    return () => { alive = false; };
  }, [threadId]);

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
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
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

  const handleAskChoice = (value: string) => {
    setAskPending(null);
    const resolve = askResolverRef.current;
    askResolverRef.current = null;
    resolve?.(value);
  };

  const handleConfirm = (ok: boolean) => {
    setConfirmPending(null);
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolve?.(ok);
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    setChatError("");

    const userText = input.trim();
    setInput("");

    // The thread is created HERE, on first send, not on mount — so opening a level and leaving does
    // not litter the list with empty conversations. The title comes from this first message via a
    // pure function, deliberately not a model call: titling is not worth 3-8s on a CPU box.
    let activeThread = threadId;
    if (!activeThread) {
      const t = await createChatThread(courseId, level, deriveThreadTitle(userText));
      activeThread = t.id;
      onThreadCreated(t.id);
    }

    const userMsg = await saveChatMessage(courseId, "user", userText, level, activeThread);
    setMessages((prev) => [...prev, userMsg]);
    void touchChatThread(activeThread).catch(() => {});
    onThreadActivity();

    // Build system prompt — with fallback if instructions not yet generated. The kernel appends
    // the <tools> manifest to this when it offers tools; a no-tool turn leaves it untouched.
    const instructions = await getTutorInstructions(courseId);
    const knowledgeSummary = await getKnowledgeSummary(courseId);
    const baseConfig = await getChatConfig();
    // Resolve the window this turn runs in: the smaller of what the model supports and what the user
    // allowed. Before #86 nothing sent num_ctx at all, so Ollama silently used its own default and
    // dropped the front of the prompt — the system message and the tools manifest — with no error.
    const profile = await detectModelProfile(baseConfig);
    // The setting caps what we ASK OLLAMA FOR — it is a RAM knob, and cloud providers size their own
    // windows. Applying it to cloud too would silently trim an OpenAI/Anthropic conversation to 8k
    // for no benefit, which is neither what the setting says nor what the user would expect.
    const contextTokens = baseConfig.provider === "ollama"
      ? Math.min(profile.contextTokens, await getMaxContextTokens())
      : profile.contextTokens;
    const config = { ...baseConfig, modelTier: profile.tier, contextTokens };
    const modelTier = profile.tier;
    // Two orthogonal skill axes feed the turn: the mode skill (from the bar) and the course's domain
    // skill (math-tutor/code-tutor, code-routed from the topic). Both gate tools (selectTools unions
    // their tools_required) and contribute <skill_bundle> rules. domainSkill is null off-subject.
    const activeSkill = resolveSkill(activeMode) ?? null;
    // Domain skills (math-tutor/code-tutor) compose with TEACHING modes, but not with the focused
    // "assess" mastery-check — adding its render tools + pedagogy there destabilizes the 4B model's
    // tool selection (it stopped calling progress.mark_mastered). Keep assess to its Phase-2 tool set.
    const domainSkill = activeSkill?.name === "assess" ? null : (resolveDomainSkill(course.topic, modelTier) ?? null);
    const skillSuffix = (skillBundleLayer(activeSkill) ?? "") + (skillBundleLayer(domainSkill) ?? "");
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
    );

    // Only include system message if it has content
    const llmMessages = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role as string, content: m.content })),
      { role: "user", content: userText },
    ];

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamingText("");
    setToolEvents([]);
    setGroundingNote(null);
    setSuggestions([]);
    setPendingMode(null); // consumed by this turn

    const turn: TutorTurn = {
      messages: llmMessages,
      config,
      retrieval: await getRetrievalMode(),
      onText: (chunk) => setStreamingText((prev) => prev + chunk),
      onToolEvent: (ev) => setToolEvents((prev) => [...prev.filter((e) => e.id !== ev.id), ev]),
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
      askUser: (question, choices) =>
        new Promise<string>((resolve) => {
          askResolverRef.current = resolve;
          setAskPending({ question, choices });
        }),
      confirmTool: (toolName, summary) =>
        new Promise<boolean>((resolve) => {
          confirmResolverRef.current = resolve;
          setConfirmPending({ toolName, summary });
        }),
    };

    try {
      const result = await tutorEngine.run(turn, ctx);
      // Three different things, previously collapsed into one flag. "abandoned" means the student
      // stopped it or the stream died; "truncated" means the model ran out of room mid-sentence but
      // what it did say is usable. Only the first should suppress follow-ups.
      const abandoned = result.stopReason === "aborted" || result.stopReason === "stalled";
      const truncated = result.stopReason === "length";
      const partial = abandoned || truncated;
      if (result.text.trim()) {
        // Persist an interrupted reply WITH a marker rather than silently as a finished answer.
        // Two bugs met here before #86: a stall left `controller.signal.aborted` false, so a truncated
        // half-sentence was written as the tutor's final word; and a real abort wrote nothing at all,
        // leaving the student's question hanging in the transcript with no reply forever — which then
        // became history that teaches the model unanswered questions are normal.
        const suffix = result.stopReason === "stalled"
          ? "\n\n_[the tutor stopped responding — ask again to continue]_"
          : result.stopReason === "aborted"
            ? "\n\n_[stopped]_"
            : result.stopReason === "length"
              ? "\n\n_[cut off at the length limit — ask the tutor to continue]_"
              : "";
        const assistantMsg = await saveChatMessage(courseId, "assistant", result.text + suffix, level, activeThread);
        setMessages((prev) => [...prev, assistantMsg]);
        // Post-turn knowledge reflection — non-blocking, best-effort. Skipped when
        // knowledge.update_map already wrote this turn so there's exactly one writer, and skipped on
        // a partial turn: reflecting over a truncated fragment writes bad knowledge permanently.
        if (!result.usedKnowledgeUpdate && !partial) {
          updateKnowledgeFiles(courseId, userText, result.text, config).catch(() => {});
        }
      }
      // The honesty surface (#90, and Tate's Q2). Three distinct states, and the middle one is the
      // whole point: retrieval fired and the answer did NOT use it. Hiding that case is exactly how a
      // tutor ends up looking like it read your notes when it didn't.
      if (result.grounding.hits.length > 0) {
        setGroundingNote(
          result.usedHits.length > 0
            ? { kind: "grounded", titles: [...new Set(result.usedHits.map((h) => h.title))] }
            : { kind: "ungrounded" },
        );
      } else {
        setGroundingNote(null);
      }
      // Follow-up chips. `countDueFlashcards` is a cheap indexed count and the only I/O here; if it
      // fails the chips just lose one option rather than the turn losing its suggestions.
      const due = await countDueFlashcards(courseId, new Date().toISOString()).catch(() => 0);
      setSuggestions(suggestFollowUps({
        answer: result.text,
        syllabus: currentSyllabus,
        hits: result.grounding.hits,
        usedHits: result.usedHits,
        dueFlashcards: due,
        abandoned,
        truncated,
      }));

      if (result.stopReason === "stalled") {
        setChatError("The model stopped sending output. If this keeps happening on a local model, it may be short on memory — try a smaller model or a smaller context window in Settings.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort|cancel/i.test(msg)) setChatError(msg);
    } finally {
      setStreamingText("");
      setStreaming(false);
      abortRef.current = null;
      setAskPending(null);
      askResolverRef.current = null;
      setConfirmPending(null);
      confirmResolverRef.current = null;
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
          <span className="text-[var(--ink-faint)] text-[10px]">▾</span>
        </button>
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
                  <span className="block text-[10px] text-[var(--ink-faint)] leading-snug">Just the tutor. No character voice.</span>
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
                    <span className="block text-[10px] text-[var(--ink-faint)] leading-snug">{p.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-[var(--ink-faint)] py-12">
            <p className="text-lg mb-2">Start chatting with your tutor</p>
            <p className="text-sm">
              Ask about <span className="text-phosphor-ink">{course.topic}</span> and your tutor will guide you through the curriculum.
            </p>
            {!currentSyllabus && (
              <p className="text-xs text-amber-500/70 mt-3">
                No syllabus loaded yet — your tutor will still help, but check the Syllabus tab once course creation finishes.
              </p>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streaming && (
          <div className="flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
              AI
            </span>
            <div className="flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
              {streamingText
                ? (
                  <div className="note-prose">
                    <div
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderChatMarkdown(streamingText) }}
                    />
                    <span className="inline-block w-1.5 h-4 bg-phosphor-ink animate-pulse ml-0.5 align-middle" />
                  </div>
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
        {!streaming && !askPending && !confirmPending && suggestions.length > 0 && (
          <SuggestionChips
            suggestions={suggestions}
            onPick={(s) => { setInput(s.message); setPendingMode(s.mode ?? null); inputRef.current?.focus(); }}
          />
        )}
        {askPending && (
          <AskUserChoices question={askPending.question} choices={askPending.choices} onPick={handleAskChoice} />
        )}
        {confirmPending && (
          <ConfirmToolCard toolName={confirmPending.toolName} summary={confirmPending.summary} onChoose={handleConfirm} />
        )}
        {chatError && (
          <div className="mx-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium btn-primary/30 text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
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
            placeholder="Ask your tutor anything..."
            className="flex-1 px-4 py-3 rounded-xl bg-panel-lite border border-[var(--rule)] text-ink placeholder-[var(--ink-faint)] text-sm focus:outline-none focus:border-phosphor"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={cancelStream}
              title="Stop generating"
              className="px-4 py-3 rounded-xl bg-lcd hover:bg-red-500/20 text-[var(--ink-faint)] hover:text-red-400 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-4 py-3 rounded-xl btn-primary hover:bg-[rgb(var(--phosphor-rgb)/0.24)] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
        isUser ? "bg-lcd text-[var(--ink-dim)]" : "bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright"
      }`}>
        {isUser ? "You" : "AI"}
      </span>
      <div className={`max-w-[75%] p-3 rounded-xl text-sm leading-relaxed ${
        isUser ? "btn-primary/20 text-ink whitespace-pre-wrap" : "bg-panel text-ink"
      }`}>
        {isUser ? message.content : (
          <div
            className="note-prose"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
}

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
//   grounded   — the answer demonstrably reused these passages (n-gram overlap, not the model's word)
//   ungrounded — passages WERE retrieved and the answer used none of them
// The second is the one that keeps the product honest. A tutor that silently drops it looks like it
// read the student's notes on every turn, which on a small model it very often did not.
function GroundingNote({ note }: { note: { kind: "grounded"; titles: string[] } | { kind: "ungrounded" } }) {
  const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono border w-fit max-w-full";
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 shrink-0" />
      <div className="flex-1 flex flex-wrap items-start gap-1.5">
        {note.kind === "grounded" ? (
          note.titles.map((title) => (
            <span key={title} title="This answer used text from this source" className={`${base} bg-lcd border-phosphor/20 text-phosphor-ink`}>
              📓 Grounded in: {title}
            </span>
          ))
        ) : (
          <span
            title="Your material was searched, but this answer did not draw on it"
            className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-faint)]`}
          >
            ○ Answered from general knowledge — not your notes
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
  if (ev.kind === "error") {
    return <div className={`${base} bg-red-500/10 border-red-500/30 text-red-300`}>⚠ {ev.name}: {ev.error}</div>;
  }
  if (ev.kind === "result") {
    // notebook.search → a ✓ summary plus a "📓 Source: …" chip per cited document.
    if (ev.name === "notebook.search") {
      const results = (ev.value as { results?: NotebookSearchResult[] } | undefined)?.results ?? [];
      const sources: string[] = [];
      for (const r of results) if (!sources.includes(r.document_title)) sources.push(r.document_title);
      if (sources.length === 0) {
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>📓 notebook.search — no matching notes</div>;
      }
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ notebook.search — {results.length} passage{results.length === 1 ? "" : "s"}
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
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>🔗 OpenEdu Library — no matching reference</div>;
      }
      const clickable = !!(onOpenResource && v.id);
      const chipClass = `${base} bg-lcd border-phosphor/20 text-phosphor-ink ${clickable ? "cursor-pointer hover:border-phosphor/50 hover:text-phosphor-bright transition-colors" : ""}`;
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ library.search — found a reference
          </div>
          {clickable ? (
            <button type="button" onClick={() => onOpenResource!(v.id!)} title="Open in Resources" className={chipClass}>
              🔗 OpenEdu Library: {v.title}
            </button>
          ) : (
            <span title="Cited from the OpenEdu Library" className={chipClass}>
              🔗 OpenEdu Library: {v.title}
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
        return <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>🔎 OpenEdu Library — no matching record</div>;
      }
      const linkable = !!(onOpenResource && v.card_id);
      const lbl = `${v.computed ? "🧮 Computed" : "🔗 OpenEdu Library"}: ${v.title}`;
      const cls = `${base} bg-lcd border-phosphor/20 text-phosphor-ink ${linkable ? "cursor-pointer hover:border-phosphor/50 hover:text-phosphor-bright transition-colors" : ""}`;
      return (
        <div className="flex flex-col items-start gap-1.5">
          <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
            ✓ library.lookup — {v.dataset}
          </div>
          {linkable ? (
            <button type="button" onClick={() => onOpenResource!(v.card_id!)} title="Open in Resources" className={cls}>{lbl}</button>
          ) : (
            <span title="From the OpenEdu Library" className={cls}>{lbl}</span>
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
    // notebook.ingest → "📓 Saved 'title' (N chunks)".
    if (ev.name === "notebook.ingest") {
      const v = ev.value as { chunkCount?: number; title?: string } | undefined;
      const n = v?.chunkCount ?? 0;
      return (
        <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>
          📓 Saved{v?.title ? ` "${v.title}"` : ""} ({n} chunk{n === 1 ? "" : "s"})
        </div>
      );
    }
    // math.render → a typeset KaTeX card; diagram.render → a Mermaid card (the §6.4 render tools).
    // The source rode in the tool-call args, never a chat string. Render the card directly (no chip).
    if (ev.name === "math.render") {
      const latex = (ev.value as { latex?: string } | undefined)?.latex ?? "";
      return latex ? <Suspense fallback={null}><MathBlock latex={latex} /></Suspense> : null;
    }
    if (ev.name === "diagram.render") {
      const code = (ev.value as { mermaid?: string } | undefined)?.mermaid ?? "";
      return code ? <MermaidBlock code={code} /> : null;
    }
    return <div className={`${base} bg-[rgb(var(--phosphor-rgb)/0.08)] border-phosphor/30 text-phosphor-ink`}>✓ {ev.name}</div>;
  }
  const msg = ev.kind === "progress" ? ev.message : "running…";
  return (
    <div className={`${base} bg-lcd border-[var(--rule)] text-[var(--ink-dim)]`}>
      <span>🔧 {ev.name} — {msg}</span>
      <span className="inline-block w-1.5 h-3 bg-phosphor-ink animate-pulse" />
    </div>
  );
}

// Permission "ask" (V2 §7) — Allow / Don't allow buttons that resolve the suspended turn. Reuses
// the ask_user choice-card look; declining feeds the model a "student declined" tool result.
function ConfirmToolCard({ toolName, summary, onChoose }: { toolName: string; summary: string; onChoose: (ok: boolean) => void }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
        AI
      </span>
      <div className="flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
        <p className="mb-1">Allow the tutor to run <span className="font-mono text-phosphor-ink">{toolName}</span>?</p>
        <p className="mb-2.5 text-[var(--ink-dim)] text-[13px]">{summary}</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onChoose(true)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium btn-primary/30 text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => onChoose(false)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-lcd text-[var(--ink-dim)] border border-[var(--rule)] hover:text-red-300 hover:border-red-500/30 transition-colors"
          >
            Don't allow
          </button>
        </div>
      </div>
    </div>
  );
}

// ask_user.question — choice buttons that resolve the suspended turn on click.
function AskUserChoices({ question, choices, onPick }: { question: string; choices: AskChoice[]; onPick: (value: string) => void }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0">
        AI
      </span>
      <div className="flex-1 p-3 rounded-xl bg-panel text-sm text-ink">
        <p className="mb-2.5">{question}</p>
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c.value}
              onClick={() => onPick(c.value)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium btn-primary/30 text-phosphor-bright border border-phosphor/40 hover:bg-[rgb(var(--phosphor-rgb)/0.24)] transition-colors"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
