// The declarative section list — the plugin-ready seam. Adding a settings area = adding one entry here.
import type { SectionDef } from "./types";
import ProviderModels from "./sections/ProviderModels";
import WebLibrary from "./sections/WebLibrary";
import Permissions from "./sections/Permissions";
import Appearance from "./sections/Appearance";
import About from "./sections/About";

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

export const SECTIONS: SectionDef[] = [
  {
    id: "provider",
    label: "Provider & Models",
    keywords: "provider ollama openai anthropic cloud local model llm generation chat embedding api key connection url verify tier nomic",
    icon: <Icon d="M9 3v2|15 3v2|9 19v2|15 19v2|3 9h2|3 15h2|19 9h2|19 15h2|M7 7h10v10H7z|M10 10h4v4h-4z" />,
    Component: ProviderModels,
  },
  {
    id: "web-library",
    label: "Web & Library",
    keywords: "web search tavily internet library reference offline curated periodic table formulas resources lookup bundled",
    icon: <Icon d="M2 12h20|M12 2a15 15 0 0 1 0 20|M12 2a15 15 0 0 0 0 20|M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />,
    Component: WebLibrary,
  },
  {
    id: "permissions",
    label: "Permissions",
    keywords: "permissions tutor preset standard cautious trusting allow ask deny exam study web code grid tool security autonomy",
    icon: <Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    Component: Permissions,
  },
  {
    id: "appearance",
    label: "Appearance",
    keywords: "appearance theme color crt amber green synthwave dark light phosphor scanlines glow look skin font",
    icon: <Icon d="M12 2a10 10 0 1 0 0 20c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.5-1-.3-.3-.5-.6-.5-1 0-.8.7-1.5 1.5-1.5H16a4 4 0 0 0 4-4c0-4.4-3.6-8-8-8z|M7.5 12a1 1 0 1 0 0-.001|M12 7.5a1 1 0 1 0 0-.001|M16.5 11a1 1 0 1 0 0-.001" />,
    Component: Appearance,
  },
  {
    id: "about",
    label: "About",
    keywords: "about version build update release github diagnostics status self check export import backup reset defaults restore",
    icon: <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 16v-4|M12 8h.01" />,
    Component: About,
  },
];
