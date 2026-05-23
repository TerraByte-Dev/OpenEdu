import { useState, useCallback } from "react";
import type { Course } from "../types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

interface ContextMenuState {
  x: number;
  y: number;
  courseId: string;
}

interface SidebarProps {
  courses: Course[];
  selectedCourseId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelectCourse: (id: string) => void;
  onDeleteCourse: (id: string) => void;
  onResumeCourse: (id: string) => void;
  onGoHome: () => void;
}

// A course needs resume when generation_state is set and isn't "completed".
// null = legacy/finished course (no resume info recorded).
function needsResume(course: Course): boolean {
  const s = course.generation_state;
  return s !== null && s !== undefined && s !== "completed";
}

export default function Sidebar({
  courses,
  selectedCourseId,
  collapsed,
  onToggle,
  onSelectCourse,
  onDeleteCourse,
  onResumeCourse,
  onGoHome,
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
    const items: ContextMenuItem[] = [
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
    ];
    if (course && needsResume(course)) {
      items.push({
        label: "Resume Generation",
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        ),
        onClick: () => onResumeCourse(courseId),
      });
    }
    items.push(
      {
        label: `Level ${course?.current_level ?? "—"}`,
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
    );
    return items;
  };

  return (
    <>
      <aside
        className={`flex flex-col bg-panel border-r border-[var(--rule)] transition-all duration-200 ${
          collapsed ? "w-14" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[var(--rule)]">
          {!collapsed && (
            <button onClick={onGoHome} className="flex items-center gap-1.5 hover:opacity-90 group">
              <span
                className="phosphor-glow text-phosphor"
                style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", lineHeight: 1 }}
              >
                OE
              </span>
              <span
                className="text-phosphor-ink uppercase tracking-widest"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}
              >
                OpenEdu
              </span>
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-lcd text-[var(--ink-faint)] hover:text-ink"
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
              <span className="text-[10px] uppercase tracking-wider text-[var(--ink-faint)] font-semibold">
                Courses
              </span>
            </div>
          )}
          {courses.map((course) => {
            const incomplete = needsResume(course);
            return (
              <button
                key={course.id}
                onClick={() => incomplete ? onResumeCourse(course.id) : onSelectCourse(course.id)}
                onContextMenu={(e) => handleCourseRightClick(e, course.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-panel-lite transition-colors ${
                  selectedCourseId === course.id
                    ? "bg-panel-lite border-l-2 border-phosphor"
                    : "border-l-2 border-transparent"
                }`}
                title={incomplete ? `Click to resume generation (${course.generation_state})` : course.title}
              >
                <span className="w-7 h-7 rounded-lg bg-[rgb(var(--phosphor-rgb)/0.08)] text-phosphor-bright flex items-center justify-center text-xs font-bold shrink-0 relative">
                  {course.title.charAt(0).toUpperCase()}
                  {incomplete && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse"
                      title="Generation incomplete — click to resume"
                    />
                  )}
                </span>
                {!collapsed && (
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{course.title}</div>
                    <div className="text-[10px] text-[var(--ink-faint)]">
                      {incomplete ? (
                        <span className="text-amber-400/90">Resume generation</span>
                      ) : (
                        <>Level {course.current_level}</>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
          {courses.length === 0 && !collapsed && (
            <div className="px-3 py-4 text-xs text-[var(--ink-faint)] text-center">
              No courses yet. Create one from the dashboard.
            </div>
          )}
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
            className="bg-panel border border-[var(--rule)] rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-ink font-semibold text-base mb-2">Delete Course?</h3>
            <p className="text-[var(--ink-faint)] text-sm mb-5">
              This will permanently delete{" "}
              <span className="text-ink font-medium">
                {courses.find((c) => c.id === confirmDelete)?.title ?? "this course"}
              </span>{" "}
              and all its chats, notes, and syllabuses. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-lcd hover:bg-panel text-[var(--ink-dim)] text-sm transition-colors"
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
