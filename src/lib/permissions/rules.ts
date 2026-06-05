// Permission rules (docs/ARCHITECTURE.md). A per-mode allow/ask/deny policy for what the tutor may
// do on its own. The kernel reads this when selecting + dispatching tools: "deny" tools are never
// offered to the model, "ask" tools require a user confirm, "allow" tools just run.

import type { PermissionMode } from "../tools/EduTool";

export type PermissionDecision = "allow" | "ask" | "deny";

// Keyed by exact tool name OR a "class.*" wildcard (e.g. "study_plan.*"). A mode missing from an
// entry falls back to evaluate.ts's read/write default.
export type PermissionRules = Record<string, Partial<Record<PermissionMode, PermissionDecision>>>;

// The V2 §7 matrix. Reads allow everywhere; writes to the student's record ask by default but are
// allowed while actively studying; network/sandbox/ingestion are tighter; exam mode denies model
// help. Tools from later phases are listed so they inherit sane defaults the moment they register.
// (The "bypass" mode is handled in evaluate.ts and always allows, so it isn't enumerated here.)
export const DEFAULT_PERMISSION_RULES: PermissionRules = {
  // reads / always-on
  "ask_user.question":      { default: "allow", study: "allow", exam: "allow" },
  "notebook.search":        { default: "allow", study: "allow", exam: "allow" },
  // curated, trusted reference (OpenEdu Library) — free during normal study; exam asks so surfacing
  // a reference during a promotion test is a conscious choice (softer than the open-web web.* deny).
  "library.search":         { default: "allow", study: "allow", exam: "ask" },
  // deterministic single-record lookups (presidents, capitals, formulas, base conversions) — same
  // curated/offline trust class as library.search, so the same allow/allow/ask policy.
  "library.lookup":         { default: "allow", study: "allow", exam: "ask" },
  "knowledge.read":         { default: "allow", study: "allow", exam: "allow" },
  "progress.read":          { default: "allow", study: "allow", exam: "allow" },
  "study_plan.*":           { default: "allow", study: "allow", exam: "allow" },
  "flashcard.review_due":   { default: "allow", study: "allow", exam: "allow" },
  // model help — denied during an exam
  "quiz.generate":          { default: "allow", study: "allow", exam: "deny" },
  "math.render":            { default: "allow", study: "allow", exam: "deny" },
  "diagram.render":         { default: "allow", study: "allow", exam: "deny" },
  // writes to the student's record — ask by default, allowed while studying
  "knowledge.update_map":   { default: "ask", study: "allow", exam: "allow" },
  "progress.mark_mastered": { default: "ask", study: "allow", exam: "allow" },
  // network / sandbox / ingestion
  "web.search":             { default: "ask", study: "ask", exam: "deny" },
  "web.fetch":              { default: "ask", study: "ask", exam: "deny" },
  "code.run":               { default: "ask", study: "allow", exam: "ask" },
  "notebook.ingest":        { default: "ask", study: "ask", exam: "deny" },
};

// The tool rows surfaced in the Settings → Permissions editor (stable order). Kept here so the UI
// and the defaults can't drift.
export const PERMISSION_ROWS: string[] = Object.keys(DEFAULT_PERMISSION_RULES);

// The modes shown as columns in the editor. "bypass" is intentionally omitted (it's the always-allow
// escape hatch, not a user-editable policy).
export const PERMISSION_EDITABLE_MODES: PermissionMode[] = ["default", "study", "exam"];
