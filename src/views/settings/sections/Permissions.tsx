import { useEffect, useState } from "react";
import {
  loadPermissionRules, savePermissionRules,
  PERMISSION_ROWS, PERMISSION_EDITABLE_MODES, PERMISSION_PRESETS, detectPreset,
  type PermissionRules, type PermissionDecision,
} from "../../../lib/permissions";
import type { PermissionMode } from "../../../lib/tools";
import { Section, Disclosure, useSettings } from "../primitives";

// Friendly labels for the raw tool ids in the Advanced grid.
const TOOL_LABELS: Record<string, string> = {
  "ask_user.question": "Ask you a question",
  "notebook.search": "Search your notebook",
  "library.search": "Search the library",
  "library.lookup": "Look up a fact",
  "knowledge.read": "Read course knowledge",
  "progress.read": "Read your progress",
  "study_plan.*": "Manage study plan",
  "flashcard.review_due": "Review due flashcards",
  "quiz.generate": "Generate a quiz",
  "math.render": "Render math",
  "diagram.render": "Render a diagram",
  "knowledge.update_map": "Update knowledge map",
  "progress.mark_mastered": "Mark a topic mastered",
  "web.search": "Search the web",
  "web.fetch": "Fetch a web page",
  "code.run": "Run code",
  "notebook.ingest": "Add files to notebook",
};

const DECISION_CLS: Record<PermissionDecision, string> = {
  allow: "text-emerald-400",
  ask: "text-amber-400",
  deny: "text-red-400",
};

export default function Permissions() {
  const { markSaved } = useSettings();
  const [permRules, setPermRules] = useState<PermissionRules | null>(null);

  useEffect(() => { (async () => setPermRules(await loadPermissionRules()))(); }, []);

  if (!permRules) return null;
  const activePreset = detectPreset(permRules);

  const applyPreset = async (rules: PermissionRules) => {
    const next = { ...rules };
    setPermRules(next);
    await savePermissionRules(next);
    markSaved();
  };

  const setCell = async (tool: string, mode: PermissionMode, decision: PermissionDecision) => {
    const next = { ...permRules, [tool]: { ...permRules[tool], [mode]: decision } };
    setPermRules(next);
    await savePermissionRules(next);
    markSaved();
  };

  return (
    <Section
      title="Tutor Permissions"
      description="What the tutor may do on its own. Pick a preset, or open Advanced for per-tool control. Allow runs automatically · Ask prompts you first · Deny blocks it."
      keywords="permissions tutor preset standard cautious trusting allow ask deny web code grid tool security"
      right={
        <button
          onClick={() => applyPreset(PERMISSION_PRESETS[0].rules)}
          className="btn text-xs"
          title="Reset permissions to the Standard preset"
        >
          Restore defaults
        </button>
      }
    >
      {/* Preset cards */}
      <div className="grid sm:grid-cols-3 gap-2.5">
        {PERMISSION_PRESETS.map((p) => {
          const active = activePreset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p.rules)}
              className={`text-left rounded-lg border px-3.5 py-3 transition-colors ${
                active ? "border-phosphor bg-[rgb(var(--phosphor-rgb)/0.08)]" : "border-[var(--rule)] bg-panel-lite/60 hover:border-[var(--ink-faint)]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${active ? "border-phosphor" : "border-[var(--rule)]"}`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-phosphor" />}
                </span>
                <span className={`text-sm font-semibold ${active ? "text-phosphor-bright" : "text-ink"}`}>{p.name}</span>
              </div>
              <p className="text-[11px] text-[var(--ink-faint)] leading-relaxed">{p.blurb}</p>
            </button>
          );
        })}
      </div>
      {activePreset === "custom" && (
        <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Custom — you've hand-tuned the per-tool grid below. Pick a preset to reset.
        </p>
      )}

      {/* Advanced per-tool grid */}
      <Disclosure summary="Advanced — per-tool control">
        <p className="text-xs text-[var(--ink-faint)] mb-3">
          One row per thing the tutor can do. Changes save automatically.
        </p>
        <div className="rounded-lg border border-[var(--rule)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-panel-lite text-[var(--ink-faint)] text-[10px] uppercase tracking-wider">
                <th className="text-left font-semibold px-3 py-2">Tool</th>
                {PERMISSION_EDITABLE_MODES.map((m) => (
                  <th key={m} className="text-left font-semibold px-3 py-2 capitalize">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((tool) => (
                <tr key={tool} className="border-t border-[var(--rule)]">
                  <td className="px-3 py-2">
                    <div className="text-[13px] text-ink leading-tight">{TOOL_LABELS[tool] ?? tool}</div>
                    <div className="font-mono text-[10px] text-[var(--ink-faint)]">{tool}</div>
                  </td>
                  {PERMISSION_EDITABLE_MODES.map((mode) => {
                    const decision = (permRules[tool]?.[mode] ?? "ask") as PermissionDecision;
                    return (
                      <td key={mode} className="px-3 py-2">
                        <select
                          value={decision}
                          onChange={(e) => setCell(tool, mode, e.target.value as PermissionDecision)}
                          className={`bg-panel-lite border border-[var(--rule)] rounded-md px-2 py-1 text-[12px] font-medium focus:outline-none focus:border-phosphor ${DECISION_CLS[decision]}`}
                        >
                          <option value="allow" className="text-ink">allow</option>
                          <option value="ask" className="text-ink">ask</option>
                          <option value="deny" className="text-ink">deny</option>
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </Section>
  );
}
