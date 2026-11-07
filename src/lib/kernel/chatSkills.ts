// Which skills a ChatTab turn runs with, and the <skill_bundle> text they add to the system prompt.
// Pure (no Tauri), so the k12-flow eval builds its prompt through the same rule the app uses.
//
// Two orthogonal skill axes feed the turn: the mode skill (from the bar) and the course's domain
// skill (math-tutor/code-tutor, code-routed from the topic). Both gate tools (selectTools unions
// their tools_required) and contribute <skill_bundle> rules. domainSkill is null off-subject.

import { resolveSkill, resolveDomainSkill } from "../skills";
import { skillBundleLayer } from "./systemPrompt";
import type { Skill } from "../dsl/skill";
import type { ModelTier } from "../../types";

export function chatTurnSkills(
  mode: string,
  topic: string,
  tier: ModelTier,
  supportsTools: boolean,
): { activeSkill: Skill | null; domainSkill: Skill | null; skillSuffix: string } {
  const activeSkill = resolveSkill(mode) ?? null;
  // Domain skills (math-tutor/code-tutor) compose with TEACHING modes, but not with the focused
  // "assess" mastery-check — adding its render tools + pedagogy there destabilizes the 4B model's
  // tool selection (it stopped calling progress.mark_mastered). Keep assess to its Phase-2 tool set.
  // A model without tool support gets no domain skill either: its bundle orders tool calls ("you
  // MUST call math.render") that the model can't make (#127).
  const domainSkill = activeSkill?.name === "assess" || !supportsTools
    ? null
    : (resolveDomainSkill(topic, tier) ?? null);
  const skillSuffix = (skillBundleLayer(activeSkill) ?? "") + (skillBundleLayer(domainSkill) ?? "");
  return { activeSkill, domainSkill, skillSuffix };
}
