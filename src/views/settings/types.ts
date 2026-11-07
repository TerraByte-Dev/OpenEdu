import type { ComponentType, ReactNode } from "react";
import type { UsageMode } from "../../lib/usage-modes";
import type { PinRecord } from "../../lib/learner-pin";

// What the "Who uses this computer?" section needs from App: the mode lives in the DB and changing it
// re-shapes the whole app (picker, chip, teacher PIN), so App owns it and hands these down.
export interface UsageControls {
  mode: UsageMode;
  teacher: { pin_hash: string | null; pin_salt: string | null };
  /** `teacher`: a new PIN record, null to clear it, undefined to keep it. */
  changeMode: (to: UsageMode, teacher: PinRecord | null | undefined) => Promise<void>;
  openTeacher: () => void;
  openLearnerMenu: () => void;
}

// Props every settings section receives from the shell. Sections are self-contained (they load/save their
// own slice of state); this only carries chrome-affecting callbacks.
export interface SectionProps {
  // Call after a change that affects app-wide chrome — e.g. switching provider updates the titlebar dot.
  onProviderChanged?: () => void;
  usage?: UsageControls;
}

// A tab in the left rail. The declarative section list (registry.ts) is the plugin-ready seam: adding a
// settings area = adding one SectionDef entry.
export interface SectionDef {
  id: string;
  label: string;
  keywords: string;   // searchable bag-of-words covering this section's rows (drives rail + row filtering)
  icon: ReactNode;
  Component: ComponentType<SectionProps>;
}
