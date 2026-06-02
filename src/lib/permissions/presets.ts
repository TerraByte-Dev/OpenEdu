// Named permission presets surfaced in Settings → Permissions. These are pure *presentation sugar* over
// the existing PermissionRules: each preset is a full rule set the user can apply with one click, after
// which the per-tool Advanced grid still edits the same underlying shape. The kernel contract
// (evaluate.ts) and the PermissionRules type are untouched.
//
// Invariant: the **exam** column is identical across every preset (it always equals the built-in default).
// Presets only ever relax/tighten the `default` and `study` columns — exam integrity (no model help during
// promotion tests) is never loosened by picking a preset. The Advanced grid can still override exam by hand.

import type { PermissionMode } from "../tools/EduTool";
import { DEFAULT_PERMISSION_RULES, PERMISSION_ROWS, PERMISSION_EDITABLE_MODES, type PermissionDecision, type PermissionRules } from "./rules";

export interface PermissionPreset {
  id: string;
  name: string;
  blurb: string;
  rules: PermissionRules;
}

// Tools whose autonomous use carries real cost/risk: writes to the learner's record, the open web,
// the code sandbox, and notebook ingestion. "Cautious" makes these ask in everyday + study modes.
const RESTRICTED_TOOLS = new Set<string>([
  "knowledge.update_map",
  "progress.mark_mastered",
  "web.search",
  "web.fetch",
  "code.run",
  "notebook.ingest",
]);

// Rebuild a rule set from the defaults, overriding only the `default`/`study` columns per tool while
// preserving each tool's existing `exam` decision (the integrity invariant above).
function buildPreset(
  setColumns: (tool: string, modes: Partial<Record<PermissionMode, PermissionDecision>>) => Partial<Record<"default" | "study", PermissionDecision>>,
): PermissionRules {
  const out: PermissionRules = {};
  for (const [tool, modes] of Object.entries(DEFAULT_PERMISSION_RULES)) {
    out[tool] = { ...modes, ...setColumns(tool, modes) };
  }
  return out;
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: "standard",
    name: "Standard",
    blurb: "Sensible defaults for everyday study — the tutor handles routine work and asks before anything sensitive.",
    rules: { ...DEFAULT_PERMISSION_RULES },
  },
  {
    id: "cautious",
    name: "Cautious",
    blurb: "Ask before the web, running code, ingesting files, or changing your record — even while studying.",
    rules: buildPreset((tool) => (RESTRICTED_TOOLS.has(tool) ? { default: "ask", study: "ask" } : {})),
  },
  {
    id: "trusting",
    name: "Trusting",
    blurb: "Let the tutor act on its own during normal use and study. Exam mode still locks model help.",
    rules: buildPreset(() => ({ default: "allow", study: "allow" })),
  },
];

// Which preset (if any) the given rule set currently matches, by comparing the editable columns over the
// known tool rows. Returns the preset id, or "custom" when the user has hand-tuned the grid.
export function detectPreset(rules: PermissionRules): string {
  const matches = (preset: PermissionRules): boolean =>
    PERMISSION_ROWS.every((tool) =>
      PERMISSION_EDITABLE_MODES.every((mode) => (rules[tool]?.[mode]) === (preset[tool]?.[mode])),
    );
  for (const preset of PERMISSION_PRESETS) {
    if (matches(preset.rules)) return preset.id;
  }
  return "custom";
}
