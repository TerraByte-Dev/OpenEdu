import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import type { Course, ChatMessage, Syllabus } from "../types";
import { getChatMessages, saveChatMessage, getTutorInstructions } from "../lib/db";
import { buildSystemPrompt } from "../lib/curriculum";
import { detectModelTier } from "../lib/llm";
import { getChatConfig } from "../lib/store";
import { getKnowledgeSummary, updateKnowledgeFiles } from "../lib/knowledge";
import { TUTOR_MODES, type TutorModeId } from "../lib/tutor-modes";
import { tutorEngine, skillBundleLayer, type TutorTurn, type ToolUIEvent } from "../lib/kernel";
import { resolveSkill } from "../lib/skills";
import type { ToolContext, AskChoice } from "../lib/tools";

marked.setOptions({ gfm: true, breaks: true });

interface ChatTabProps {
  courseId: string;
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
  seedTopic?: string;
  onSeedConsumed?: () => void;
}

export default function ChatTab({ courseId, course, level, currentSyllabus, seedTopic, onSeedConsumed }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [chatError, setChatError] = useState("");
  const [activeMode, setActiveMode] = useState<TutorModeId>("explain");
  // Live tool activity for the current/just-finished turn (session-only; not persisted).
  const [toolEvents, setToolEvents] = useState<ToolUIEvent[]>([]);
  // A pending ask_user.question — renders inline buttons and suspends the turn until a pick.
  const [askPending, setAskPending] = useState<{ question: string; choices: AskChoice[] } | null>(null);
  const askResolverRef = useRef<((value: string) => void) | null>(null);
  // A pending permission "ask" — renders an Allow / Don't allow card and suspends until the choice.
  const [confirmPending, setConfirmPending] = useState<{ toolName: string; summary: string } | null>(null);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const msgs = await getChatMessages(courseId, level);
      setMessages(msgs);
    })();
  }, [courseId, level]);

  // Deep-link from OverviewTab / NextStepCard: pre-fill the input with a topic
  // prompt and let the user edit or send. Consumed once.
  useEffect(() => {
    if (!seedTopic) return;
    setInput(`Help me with ${seedTopic}.`);
    inputRef.current?.focus();
    onSeedConsumed?.();
  }, [seedTopic, onSeedConsumed]);

  // Abort any in-flight stream on unmount or when level/course changes
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
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

    const userMsg = await saveChatMessage(courseId, "user", userText, level);
    setMessages((prev) => [...prev, userMsg]);

    // Build system prompt — with fallback if instructions not yet generated. The kernel appends
    // the <tools> manifest to this when it offers tools; a no-tool turn leaves it untouched.
    const instructions = await getTutorInstructions(courseId);
    const knowledgeSummary = await getKnowledgeSummary(courseId);
    // The active skill (selected via the mode bar) gates tools + supplies the <skill_bundle> rules.
    const activeSkill = resolveSkill(activeMode) ?? null;
    const systemPrompt = buildSystemPrompt(
      instructions,
      currentSyllabus,
      course.current_level,
      course.topic,
      skillBundleLayer(activeSkill) ?? "",
      knowledgeSummary || undefined,
    );

    // Only include system message if it has content
    const llmMessages = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role as string, content: m.content })),
      { role: "user", content: userText },
    ];

    const config = await getChatConfig();
    const modelTier = await detectModelTier(config);
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamingText("");
    setToolEvents([]);

    const turn: TutorTurn = {
      messages: llmMessages,
      config,
      onText: (chunk) => setStreamingText((prev) => prev + chunk),
      onToolEvent: (ev) => setToolEvents((prev) => [...prev.filter((e) => e.id !== ev.id), ev]),
    };

    const ctx: ToolContext = {
      courseId,
      level,
      syllabus: currentSyllabus,
      modelTier,
      permissionMode: "default", // Phase 2: rules live in permissions.json; "default" asks before writes
      config,
      abort: controller.signal,
      activeSkill,
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
      if (!controller.signal.aborted && result.text.trim()) {
        const assistantMsg = await saveChatMessage(courseId, "assistant", result.text, level);
        setMessages((prev) => [...prev, assistantMsg]);
        // Post-turn knowledge reflection — non-blocking, best-effort. Skipped when
        // knowledge.update_map already wrote this turn so there's exactly one writer.
        if (!result.usedKnowledgeUpdate) {
          updateKnowledgeFiles(courseId, userText, result.text, config).catch(() => {});
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/abort/i.test(msg)) setChatError(msg);
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
                      dangerouslySetInnerHTML={{ __html: marked.parse(streamingText) as string }}
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
        {toolEvents.length > 0 && <ToolActivity events={toolEvents} />}
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
        {/* Mode selector */}
        <div className="flex gap-1 max-w-3xl mx-auto mb-2.5">
          {TUTOR_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              title={mode.title}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                activeMode === mode.id
                  ? "btn-primary/30 text-phosphor-bright border border-phosphor/40"
                  : "text-[var(--ink-faint)] hover:text-[var(--ink-dim)] hover:bg-panel-lite"
              }`}
            >
              <span>{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
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
            dangerouslySetInnerHTML={{ __html: marked.parse(message.content) as string }}
          />
        )}
      </div>
    </div>
  );
}

// Inline tool activity — progress chips that become result / error cards. Identity is the
// tool_call id, so a chip transitions in place. Session-only (not persisted in Phase 1).
function ToolActivity({ events }: { events: ToolUIEvent[] }) {
  return (
    <div className="flex gap-3">
      <span className="w-8 h-8 shrink-0" />
      <div className="flex-1 flex flex-col items-start gap-1.5">
        {events.map((ev) => (
          <ToolChip key={ev.id} ev={ev} />
        ))}
      </div>
    </div>
  );
}

function ToolChip({ ev }: { ev: ToolUIEvent }) {
  const base = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono border w-fit max-w-full";
  if (ev.kind === "error") {
    return <div className={`${base} bg-red-500/10 border-red-500/30 text-red-300`}>⚠ {ev.name}: {ev.error}</div>;
  }
  if (ev.kind === "result") {
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
