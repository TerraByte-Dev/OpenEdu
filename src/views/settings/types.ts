import type { ComponentType, ReactNode } from "react";
import type { Grade } from "../../lib/grade";
import type { LearnerRow } from "../../lib/learners";

// The signed-in learner, for the Name & grade section. App owns the learner list, so it saves and
// re-reads the learner.
export interface LearnerControls {
  id: string;
  name: string;
  /** Every learner, for the unique-name rule (learners.ts validateLearnerName). */
  learners: ReadonlyArray<Pick<LearnerRow, "id" | "name">>;
  grade: Grade | null;
  /** Throws when the save fails. */
  setGrade: (grade: Grade | null) => Promise<void>;
  /** Throws when the save fails. */
  rename: (name: string) => Promise<void>;
}

// Props every settings section receives from the shell. Sections are self-contained (they load/save their
// own slice of state); this only carries chrome-affecting callbacks.
export interface SectionProps {
  // Call after a change that affects app-wide chrome — e.g. switching provider updates the titlebar dot.
  onProviderChanged?: () => void;
  learner?: LearnerControls;
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
