// Resolve a permission decision for a tool in the current mode (docs/ARCHITECTURE.md).

import type { EduTool, PermissionMode } from "../tools/EduTool";
import { DEFAULT_PERMISSION_RULES, type PermissionDecision, type PermissionRules } from "./rules";

// Resolution order: "bypass" mode always allows → exact tool-name rule → "class.*" wildcard rule →
// fallback by read/write (read-only tools allow, writers ask). The active rule set is passed in so
// Settings overrides apply; defaults are used if none provided.
export function evaluatePermission(
  tool: Pick<EduTool, "name" | "isReadOnly">,
  mode: PermissionMode,
  rules: PermissionRules = DEFAULT_PERMISSION_RULES,
): PermissionDecision {
  if (mode === "bypass") return "allow";
  const dot = tool.name.indexOf(".");
  const wildcard = dot > 0 ? `${tool.name.slice(0, dot)}.*` : undefined;
  const rule = rules[tool.name] ?? (wildcard ? rules[wildcard] : undefined);
  return rule?.[mode] ?? (tool.isReadOnly ? "allow" : "ask");
}
