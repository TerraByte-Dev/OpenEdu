// The declarative section list — the plugin-ready seam. Adding a settings area = adding one entry here.
import type { SectionDef } from "./types";
import ProviderModels from "./sections/ProviderModels";
import WebLibrary from "./sections/WebLibrary";
import Permissions from "./sections/Permissions";
import Appearance from "./sections/Appearance";
import LearnerData from "./sections/LearnerData";
import About from "./sections/About";
import LearnerSection from "./sections/Learner";
import { IconCircleInfo, IconDatabase, IconGlobe, IconMicrochip, IconPalette, IconShield, IconUser } from "../../components/icons";

export const SECTIONS: SectionDef[] = [
  {
    id: "provider",
    label: "Provider & Models",
    keywords: "provider ollama openai anthropic cloud local model llm generation chat embedding api key connection url verify tier nomic",
    icon: <IconMicrochip size={16} />,
    Component: ProviderModels,
  },
  {
    id: "web-library",
    label: "Web & Library",
    keywords: "web search tavily internet library reference offline curated periodic table formulas resources lookup bundled",
    icon: <IconGlobe size={16} />,
    Component: WebLibrary,
  },
  {
    id: "permissions",
    label: "Permissions",
    keywords: "permissions tutor preset standard cautious trusting allow ask deny exam study web code grid tool security autonomy",
    icon: <IconShield size={16} />,
    Component: Permissions,
  },
  {
    id: "appearance",
    label: "Appearance",
    keywords: "appearance theme color dark light mode system night match computer look",
    icon: <IconPalette size={16} />,
    Component: Appearance,
  },
  {
    id: "learner",
    label: "Name & grade",
    keywords: "name learner rename grade school year reading level kindergarten text size read aloud speech voice speak",
    icon: <IconUser size={16} />,
    Component: LearnerSection,
  },
  {
    id: "learner-data",
    label: "Learner data",
    keywords: "learner data backup restore database copy usb save power cut damaged recover replace file",
    icon: <IconDatabase size={16} />,
    Component: LearnerData,
  },
  {
    id: "about",
    label: "About",
    keywords: "about version build update release github diagnostics status self check export import backup reset defaults restore credits dictionary wordnet licence license",
    icon: <IconCircleInfo size={16} />,
    Component: About,
  },
];
