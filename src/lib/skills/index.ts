// Public surface of the skill layer.
export { skillRegistry, loadBuiltinSkills, buildSkill, resolveSkill } from "./registry";
export type { SkillRegistry } from "./registry";
export { parseSkillFile } from "./parse";
export type { ParsedSkillFile } from "./parse";
export { matchSkillsForCourse, isSkillAvailable } from "./trigger";
export { SkillFrontmatterSchema } from "../dsl/skill";
export type { Skill, SkillFrontmatter } from "../dsl/skill";
