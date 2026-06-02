// Public surface of the permission layer.
export { evaluatePermission } from "./evaluate";
export { loadPermissionRules, savePermissionRules } from "./store";
export {
  DEFAULT_PERMISSION_RULES,
  PERMISSION_ROWS,
  PERMISSION_EDITABLE_MODES,
} from "./rules";
export type { PermissionDecision, PermissionRules } from "./rules";
export { PERMISSION_PRESETS, detectPreset } from "./presets";
export type { PermissionPreset } from "./presets";
