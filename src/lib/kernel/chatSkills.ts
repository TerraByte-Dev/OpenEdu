// Which skills a ChatTab turn runs with, and the <skill_bundle> text they add to the system prompt.
// Pure (no Tauri), so the k12-flow eval builds its prompt through the same rule the app uses.
//
// Two orthogonal skill axes feed the turn: the mode skill (from the bar) and the course's domain
// skill (math-tutor/science-tutor/code-tutor/music-tutor, code-routed from the topic, else from the
// syllabus; skills/trigger.ts). Both gate tools (selectTools unions their tools_required) and
// contribute <skill_bundle> rules. domainSkill is null off-subject.

import { resolveSkill, resolveDomainSkill } from "../skills";
import { skillBundleLayer } from "./systemPrompt";
import type { Skill } from "../dsl/skill";
import type { ModelTier } from "../../types";
import type { CourseSyllabus } from "../skills/trigger";
import type { TutorModeId } from "../tutor-modes";
import { isAssessAnswerTurn, openCheck } from "./answerCheck";
import { ASSESS_MESSAGE } from "./suggestions";

/**
 * The mode a ChatTab turn runs in. `picked` is the mode of the chip the child tapped, and wins. With
 * none, the child's answers to the questions of a check opened by the "Check if I've got this" chip run
 * in "assess": the request that opened the check still open (answerCheck.ts openCheck) is the chip's
 * own message, ASSESS_MESSAGE. Assess is the one mode
 * that offers progress.mark_mastered, and the chat resets the mode after every send, so before this the
 * answer to the check's question ran as "explain" and could never be marked. Every other turn is
 * "explain", as before: a typed "quiz me on fractions" or "test me" keeps the domain skill's drawing
 * tools and gets its quiz even when every subtopic is mastered (assess.md stops there), and the quiz
 * chip's message, as sent or edited, stays a quiz. `conversation` is the user and assistant messages,
 * ending with the one being sent.
 */
export function chatTurnMode(picked: TutorModeId | null, conversation: ReadonlyArray<{ role: string; content: string }>): TutorModeId {
  if (picked) return picked;
  if (!isAssessAnswerTurn(conversation)) return "explain";
  return openCheck(conversation)?.trim() === ASSESS_MESSAGE ? "assess" : "explain";
}

export function chatTurnSkills(
  mode: string,
  topic: string,
  tier: ModelTier,
  supportsTools: boolean,
  syllabus?: CourseSyllabus | null,
): { activeSkill: Skill | null; domainSkill: Skill | null; skillSuffix: string } {
  const activeSkill = resolveSkill(mode) ?? null;
  // Domain skills (math-tutor/code-tutor) compose with TEACHING modes, but not with the focused
  // "assess" mastery-check — adding its render tools + pedagogy there destabilizes the 4B model's
  // tool selection (it stopped calling progress.mark_mastered). Keep assess to its Phase-2 tool set.
  // A model without tool support gets no domain skill either: its bundle orders tool calls ("you
  // MUST call math.render") that the model can't make (#127).
  const domainSkill = activeSkill?.name === "assess" || !supportsTools
    ? null
    : (resolveDomainSkill(topic, tier, syllabus) ?? null);
  const skillSuffix = (skillBundleLayer(activeSkill) ?? "") + (skillBundleLayer(domainSkill) ?? "");
  return { activeSkill, domainSkill, skillSuffix };
}
