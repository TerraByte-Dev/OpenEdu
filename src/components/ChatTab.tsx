import { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import type { Course, ChatMessage, Syllabus } from "../types";
import { getChatMessages, saveChatMessage, getTutorInstructions } from "../lib/db";
import { buildSystemPrompt } from "../lib/curriculum";
import { streamChat } from "../lib/llm";
import { getChatConfig } from "../lib/store";
import { TUTOR_MODES, getTutorModePrompt, type TutorModeId } from "../lib/tutor-modes";

marked.setOptions({ gfm: true, breaks: true });

interface ChatTabProps {
  courseId: string;
  course: Course;
  level: number;
  currentSyllabus: Syllabus | null;
}

export default function ChatTab({ courseId, course, level, currentSyllabus }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [chatError, setChatError] = useState("");
  const [activeMode, setActiveMode] = useState<TutorModeId>("explain");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const msgs = await getChatMessages(courseId, level);
      setMessages(msgs);
    })();
  }, [courseId, level]);

  // Abort any in-flight stream on unmount or when level/course changes
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [courseId, level]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const cancelStream = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStreamingText("");
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    setChatError("");

    const userText = input.trim();
    setInput("");

    const userMsg = await saveChatMessage(courseId, "user", userText, level);
    setMessages((prev) => [...prev, userMsg]);

    // Build system prompt — with fallback if instructions not yet generated
    const instructions = await getTutorInstructions(courseId);
    const systemPrompt = buildSystemPrompt(
      instructions,
      currentSyllabus,
      course.current_level,
      course.topic,
      getTutorModePrompt(activeMode),
    );

    // Only include system message if it has content
    const llmMessages = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt }] : []),
      ...messages.map((m) => ({ role: m.role as string, content: m.content })),
      { role: "user", content: userText },
    ];

    const config = await getChatConfig();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamingText("");

    await streamChat({
      messages: llmMessages,
      config,
      signal: controller.signal,
      onToken: (token) => {
        setStreamingText((prev) => prev + token);
      },
      onDone: async (fullText) => {
        if (fullText.trim()) {
          const assistantMsg = await saveChatMessage(courseId, "assistant", fullText, level);
          setMessages((prev) => [...prev, assistantMsg]);
        }
        setStreamingText("");
        setStreaming(false);
        abortRef.current = null;
      },
      onError: (error) => {
        setChatError(error);
        setStreamingText("");
        setStreaming(false);
        abortRef.current = null;
      },
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-zinc-500 py-12">
            <p className="text-lg mb-2">Start chatting with your tutor</p>
            <p className="text-sm">
              Ask about <span className="text-terra-400">{course.topic}</span> and your tutor will guide you through the curriculum.
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
            <span className="w-8 h-8 rounded-lg bg-terra-700/40 text-terra-300 flex items-center justify-center text-xs font-bold shrink-0">
              AI
            </span>
            <div className="flex-1 p-3 rounded-xl bg-surface-800 text-sm text-zinc-200">
              {streamingText
                ? (
                  <div
                    className="note-prose"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: marked.parse(streamingText) as string }}
                  />
                )
                : <span className="text-zinc-500 italic">Thinking...</span>
              }
              <span className="inline-block w-1.5 h-4 bg-terra-400 animate-pulse ml-0.5 align-middle" />
            </div>
          </div>
        )}
        {chatError && (
          <div className="mx-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            <span className="font-medium">Error:</span> {chatError}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-surface-600 bg-surface-800">
        {/* Mode selector */}
        <div className="flex gap-1 max-w-3xl mx-auto mb-2.5">
          {TUTOR_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              title={mode.title}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                activeMode === mode.id
                  ? "bg-terra-600/30 text-terra-300 border border-terra-500/40"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-surface-700"
              }`}
            >
              <span>{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
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
            className="flex-1 px-4 py-3 rounded-xl bg-surface-700 border border-surface-500 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:border-terra-500"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={cancelStream}
              title="Stop generating"
              className="px-4 py-3 rounded-xl bg-surface-600 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="px-4 py-3 rounded-xl bg-terra-600 hover:bg-terra-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        isUser ? "bg-surface-600 text-zinc-300" : "bg-terra-700/40 text-terra-300"
      }`}>
        {isUser ? "You" : "AI"}
      </span>
      <div className={`max-w-[75%] p-3 rounded-xl text-sm leading-relaxed ${
        isUser ? "bg-terra-600/20 text-zinc-200 whitespace-pre-wrap" : "bg-surface-800 text-zinc-200"
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
