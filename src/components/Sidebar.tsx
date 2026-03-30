import { useState, useCallback } from "react";
import type { Course, LLMProvider } from "../types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface ContextMenuState {
  x: number;
  y: number;
  courseId: string;
}

const PROVIDER_LABEL: Record<LLMProvider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
};
const PROVIDER_COLOR: Record<LLMProvider, string> = {
  ollama: "bg-green-500",
  openai: "bg-blue-500",
  anthropic: "bg-purple-500",
};
const PROVIDER_TEXT: Record<LLMProvider, string> = {
  ollama: "text-green-400",
  openai: "text-blue-400",
  anthropic: "text-purple-400",
};

interface SidebarProps {
  courses: Course[];
  selectedCourseId: string | null;
  collapsed: boolean;
  provider: LLMProvider;
  onToggle: () => void;
  onSelectCourse: (id: string) => void;
  onDeleteCourse: (id: string) => void;
  onGoHome: () => void;
  onGoSettings: () => void;
}

export default function Sidebar({
  courses,
  selectedCourseId,
  collapsed,
  provider,
  onToggle,
  onSelectCourse,
  onDeleteCourse,
  onGoHome,
  onGoSettings,
}: SidebarProps) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleCourseRightClick = useCallback((e: React.MouseEvent, courseId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, courseId });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const buildCourseMenuItems = (courseId: string): ContextMenuItem[] => {
    const course = courses.find((c) => c.id === courseId);
    return [
      {
        label: "Open Course",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        ),
        onClick: () => onSelectCourse(courseId),
      },
      {
        label: `Level ${course?.current_level.toFixed(1) ?? "—"}`,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
        onClick: () => {},
        disabled: true,
      },
      {
        label: "Delete Course",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
          </svg>
        ),
        danger: true,
        onClick: () => setConfirmDelete(courseId),
      },
    ];
  };

  return (
    <>
      <aside
        className={`flex flex-col bg-surface-800 border-r border-surface-600 transition-all duration-200 ${
          collapsed ? "w-14" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-surface-600">
          {!collapsed && (
            <button onClick={onGoHome} className="flex items-center gap-2 hover:opacity-80">
              <span className="text-terra-400 font-bold text-lg">TT</span>
              <span className="text-sm font-semibold text-zinc-200">TerraTutor</span>
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-surface-600 text-zinc-400 hover:text-zinc-200"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {collapsed ? (
                <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>

        {/* Course list */}
        <div className="flex-1 overflow-y-auto py-2">
          {!collapsed && (
            <div className="px-3 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Courses
              </span>
            </div>
          )}
          {courses.map((course) => (
            <button
              key={course.id}
              onClick={() => onSelectCourse(course.id)}
              onContextMenu={(e) => handleCourseRightClick(e, course.id)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-700 transition-colors ${
                selectedCourseId === course.id
                  ? "bg-surface-700 border-l-2 border-terra-500"
                  : "border-l-2 border-transparent"
              }`}
              title={course.title}
            >
              <span className="w-7 h-7 rounded-lg bg-terra-700/40 text-terra-300 flex items-center justify-center text-xs font-bold shrink-0">
                {course.title.charAt(0).toUpperCase()}
              </span>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sm text-zinc-200 truncate">{course.title}</div>
                  <div className="text-[10px] text-zinc-500">
                    Level {course.current_level.toFixed(1)}
                  </div>
                </div>
              )}
            </button>
          ))}
          {courses.length === 0 && !collapsed && (
            <div className="px-3 py-4 text-xs text-zinc-500 text-center">
              No courses yet. Create one from the dashboard.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-surface-600 p-2 space-y-1">
          {/* Active provider indicator */}
          <div
            className={`flex items-center gap-2 px-2 py-1.5 rounded ${collapsed ? "justify-center" : ""}`}
            title={`Active provider: ${PROVIDER_LABEL[provider]}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${PROVIDER_COLOR[provider]}`} />
            {!collapsed && (
              <span className={`text-xs font-medium ${PROVIDER_TEXT[provider]}`}>
                {PROVIDER_LABEL[provider]}
              </span>
            )}
          </div>
          <button
            onClick={onGoSettings}
            className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-600 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {!collapsed && <span className="text-sm">Settings</span>}
          </button>
        </div>
      </aside>

      {/* Course context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCourseMenuItems(ctxMenu.courseId)}
          onClose={closeCtxMenu}
        />
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-surface-800 border border-surface-500 rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-zinc-100 font-semibold text-base mb-2">Delete Course?</h3>
            <p className="text-zinc-400 text-sm mb-5">
              This will permanently delete{" "}
              <span className="text-zinc-200 font-medium">
                {courses.find((c) => c.id === confirmDelete)?.title ?? "this course"}
              </span>{" "}
              and all its chats, notes, and syllabuses. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-surface-600 hover:bg-surface-500 text-zinc-300 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteCourse(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
