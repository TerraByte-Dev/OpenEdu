// The in-course left column.
//
// The app's left column used to be the course list, permanently — which is the one list you do not
// need while inside a course, since you are already in the thing it selects. It now belongs to the
// course you are in, and the way back to the list is the header's back arrow.
//
// That reclaims a whole column for the two surfaces that were starved of one: chat threads (which had
// been squeezed into a header dropdown) and, later, the notes tree. Tabs move here from a horizontal
// strip, which is a straight win — a vertical list has room for a label and does not compete with the
// level indicator for the same row.

import type { ReactNode } from "react";
import type { Tab } from "../views/CourseView";

export interface CourseRailProps {
  tabs: Array<{ id: Tab; label: string }>;
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  /** The active tab's own list — threads for chat, the tree for notes. Absent for tabs with none. */
  children?: ReactNode;
}

// One glyph per tab. Deliberately not emoji: these sit next to body text at small sizes, and emoji
// render at wildly different weights across fonts, which makes a vertical list look broken.
const TAB_ICONS: Record<Tab, string> = {
  overview: "◈",
  chat: "✎",
  notes: "▤",
  lessons: "▦",
  quiz: "◎",
  review: "↻",
  syllabus: "☰",
  resources: "◇",
};

export default function CourseRail({ tabs, activeTab, onSelectTab, children }: CourseRailProps) {
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-[var(--rule)] bg-panel min-h-0">
      <nav className="p-1.5 flex flex-col gap-0.5 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-left transition-colors ${
              activeTab === tab.id
                ? "bg-lcd text-phosphor-bright"
                : "text-[var(--ink-dim)] hover:text-ink hover:bg-panel-lite"
            }`}
          >
            <span className={`text-[11px] w-3 text-center ${activeTab === tab.id ? "text-phosphor" : "text-[var(--ink-faint)]"}`}>
              {TAB_ICONS[tab.id]}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* The active tab's list, when it has one. Scrolls independently of the tab nav so a long
          thread list never pushes the tabs off-screen. */}
      {children && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--rule)]">{children}</div>
      )}
    </aside>
  );
}
