// The k12-flow system prompt and skills for one item, built the way ChatTab builds them. Pure: no
// Tauri, no DB, no model.
//
// ChatTab's inputs, and what the eval course gives each one:
//   instructions   getTutorInstructions(courseId)   {}: the eval course is never created, so the
//                                                   default identity applies and there is no
//                                                   generated pedagogy or rules
//   persona        resolvePersona(spriteId)          none
//   syllabus       currentSyllabus                   null: the "## Subject" fallback names the topic
//   topic          course.topic                      the item's subject (K12_FLOW_TOPICS)
//   skills         chatTurnSkills(mode, topic, ...)  "explain" (the show-answer chip carries no mode)
//                                                   plus the domain skill the topic routes to
//   knowledge      getKnowledgeSummary(courseId)     none
//
// The k12-mc runner's K12_INSTRUCTIONS ("answer directly and concisely") is the RAG-eval prompt. It
// is NOT used here: it pushes the model toward a reveal at T1, which is what G1 measures.

import { buildSystemPrompt } from "../curriculum";
import { chatTurnSkills } from "../kernel/chatSkills";
import type { Skill } from "../dsl/skill";
import type { ModelTier } from "../../types";
import type { K12Item, K12Subject } from "./k12-items";

/** The course topic a learner would type for each subject. Frozen with the protocol. */
export const K12_FLOW_TOPICS: Record<K12Subject, string> = {
  math: "Mathematics",
  science: "Science",
  ela: "English Language Arts",
  "social-studies": "Social Studies",
};

/** Every k12-flow turn runs in this mode: typed text and the show-answer chip carry no mode. */
export const K12_FLOW_MODE = "explain";

export interface K12FlowTurnSetup {
  topic: string;
  system: string;
  activeSkill: Skill | null;
  domainSkill: Skill | null;
}

export function k12FlowTurnSetup(item: Pick<K12Item, "subject">, tier: ModelTier, supportsTools: boolean): K12FlowTurnSetup {
  const topic = K12_FLOW_TOPICS[item.subject];
  const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills(K12_FLOW_MODE, topic, tier, supportsTools);
  const system = buildSystemPrompt({}, null, 1, topic, skillSuffix);
  return { topic, system, activeSkill, domainSkill };
}
