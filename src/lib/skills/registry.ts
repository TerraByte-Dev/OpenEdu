// Skill registry — the kernel/UI's single lookup point for loaded skills (docs/ARCHITECTURE.md).
// Mirrors src/lib/tools/registry.ts. Built-in skills ship as `src/skills/*.md` and are bundled by
// Vite as raw strings; user-sideloaded skills (%APPDATA%/.../skills/) are deferred to a later phase.

import type { Skill } from "../dsl/skill";
import { SkillFrontmatterSchema } from "../dsl/skill";
import { parseSkillFile } from "./parse";

class SkillRegistry {
  private skills = new Map<string, Skill>();

  // Last writer wins, so a user skill can later override a built-in by name.
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }
  all(): Skill[] {
    return [...this.skills.values()];
  }
  clear(): void {
    this.skills.clear();
  }
}

export const skillRegistry = new SkillRegistry();
export type { SkillRegistry };

// Build a Skill from raw markdown: parse frontmatter + body, validate, derive promptSuffix. The
// promptSuffix reproduces the v1 tutor-mode suffix byte-for-byte (leading "\n\n" + trimmed body),
// which keeps the modes→skills conversion eval-neutral.
export function buildSkill(raw: string): Skill {
  const { frontmatter, body } = parseSkillFile(raw);
  const fm = SkillFrontmatterSchema.parse(frontmatter);
  const trimmed = body.trim();
  return { ...fm, body: trimmed, promptSuffix: trimmed ? `\n\n${trimmed}` : "" };
}

let loaded = false;

// Load + register the built-in skill bundles. Idempotent (like registerBuiltinTools) so the app
// init, eval harness, and HMR can all call it safely.
export function loadBuiltinSkills(): void {
  if (loaded) return;
  loaded = true;
  const modules = import.meta.glob("/src/skills/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  for (const [path, raw] of Object.entries(modules)) {
    try {
      skillRegistry.register(buildSkill(raw));
    } catch (e) {
      console.error(`[skills] failed to load ${path}:`, e);
    }
  }
}

// Resolve a skill by name (= TutorModeId for the pedagogical skills). Ensures the built-ins are
// loaded first so callers don't depend on init order.
export function resolveSkill(name: string): Skill | undefined {
  loadBuiltinSkills();
  return skillRegistry.get(name);
}

// Resolve a persona skill (Phase 4b) by sprite id → the sprite-persona-<id> bundle, or undefined
// when no persona is set (legacy NULL) or the id is unknown. Persona skills load via the same glob
// as mode/domain skills but are addressed ONLY here: they never appear in the mode bar (fixed
// TUTOR_MODES list) and are excluded from domain routing (trigger.ts), preserving the WHO axis.
export function resolvePersona(spriteId: string | null | undefined): Skill | undefined {
  if (!spriteId) return undefined;
  loadBuiltinSkills();
  return skillRegistry.get("sprite-persona-" + spriteId);
}
