import type { ComponentType, ReactNode } from "react";

// Props every settings section receives from the shell. Sections are self-contained (they load/save their
// own slice of state); this only carries chrome-affecting callbacks.
export interface SectionProps {
  // Call after a change that affects app-wide chrome — e.g. switching provider updates the titlebar dot.
  onProviderChanged?: () => void;
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
