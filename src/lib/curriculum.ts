import { callLLM, callLLMStreaming, callLLMStructured, detectModelTier, log } from "./llm";
import { saveSyllabus, saveTutorInstruction, getTutorInstruction, updateGenerationState, createLesson } from "./db";
import { initKnowledgeFiles } from "./knowledge";
import { MATH_FORMATTING_RULES, MATH_FORMATTING_RULES_PROSE } from "./formatting";
import { assembleLessonMarkdown, type LessonContent } from "./lesson-format";
import type { LLMConfig, ModelTier, Syllabus, Subtopic, Lesson, CourseOutline, OutlineLevel, ConceptLedger, LevelLedgerEntry } from "../types";

// ─── JSON Schemas for structured pipeline stages ──────────────────────────────
// Kept inline so they live next to the prompts that reference them.

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["levels", "mastery_exam"],
  properties: {
    levels: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["level", "title", "focus_areas", "key_outcomes", "bridge"],
        properties: {
          level: { type: "number", enum: [1, 2, 3, 4, 5] },
          title: { type: "string", minLength: 8, maxLength: 80 },
          focus_areas: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 6 } },
          key_outcomes: { type: "array", minItems: 2, maxItems: 3, items: { type: "string", minLength: 10 } },
          bridge: { type: "string", minLength: 12, maxLength: 220 },
        },
      },
    },
    mastery_exam: {
      type: "object",
      additionalProperties: false,
      required: ["domains", "synthesis_skills", "scenarios"],
      properties: {
        domains: { type: "array", minItems: 5, items: { type: "string" } },
        synthesis_skills: { type: "array", minItems: 3, maxItems: 4, items: { type: "string" } },
        scenarios: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
      },
    },
  },
} as const;

const TOPIC_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level_title", "level_description", "learning_objectives", "subtopics", "assessment_criteria", "estimated_hours"],
  properties: {
    level_title: { type: "string", minLength: 6, maxLength: 80 },
    level_description: { type: "string", minLength: 30, maxLength: 400 },
    learning_objectives: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 12 } },
    subtopics: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", pattern: "^[1-6]\\.[1-6]$" },
          title: { type: "string", minLength: 6, maxLength: 80 },
        },
      },
    },
    assessment_criteria: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    estimated_hours: { type: "integer", minimum: 4, maximum: 12 },
  },
} as const;

const PRACTICE_TYPES = ["code_exercise", "reading", "discussion", "guided_project", "debugging_exercise", "problem_set"] as const;

const EXPANSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["key_concepts", "practice_type", "objective"],
  properties: {
    key_concepts: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 4 } },
    practice_type: { type: "string", enum: PRACTICE_TYPES },
    objective: { type: "string", minLength: 20, maxLength: 240 },
  },
} as const;

// ─── Research schemas (5 small structured sub-calls instead of 1 free-text dump) ─
// Each schema is tight enough to fit easily in an e4b context window, with low
// minLength caps that even small models can satisfy on first try.

const RESEARCH_OVERVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["what_it_is", "why_important", "mastery_unlocks"],
  properties: {
    what_it_is: { type: "string", minLength: 60, maxLength: 400 },
    why_important: { type: "string", minLength: 60, maxLength: 400 },
    mastery_unlocks: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 8 } },
  },
} as const;

const RESEARCH_DOMAINS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["domains"],
  properties: {
    domains: {
      type: "array", minItems: 4, maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "focus"],
        properties: {
          name: { type: "string", minLength: 3, maxLength: 60 },
          focus: { type: "string", minLength: 40, maxLength: 200 },
        },
      },
    },
  },
} as const;

const PROGRESSION_STAGES = ["beginner", "foundations", "working_knowledge", "intermediate", "advanced", "mastery"] as const;

const RESEARCH_PROGRESSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stages"],
  properties: {
    stages: {
      type: "array", minItems: 6, maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "milestones", "can_build"],
        properties: {
          stage: { type: "string", enum: PROGRESSION_STAGES },
          milestones: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 6 } },
          can_build: { type: "string", minLength: 20, maxLength: 200 },
        },
      },
    },
  },
} as const;

const RESEARCH_OBSTACLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["obstacles"],
  properties: {
    obstacles: {
      type: "array", minItems: 3, maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what_blocks_learners", "common_misconception"],
        properties: {
          what_blocks_learners: { type: "string", minLength: 20, maxLength: 240 },
          common_misconception: { type: "string", minLength: 20, maxLength: 240 },
        },
      },
    },
  },
} as const;

const RESEARCH_PREREQS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prerequisites", "assume_none_needed"],
  properties: {
    prerequisites: { type: "array", minItems: 0, maxItems: 6, items: { type: "string", minLength: 4 } },
    assume_none_needed: { type: "boolean" },
  },
} as const;

interface ResearchOverview { what_it_is: string; why_important: string; mastery_unlocks: string[] }
interface ResearchDomains { domains: Array<{ name: string; focus: string }> }
interface ResearchProgression { stages: Array<{ stage: string; milestones: string[]; can_build: string }> }
interface ResearchObstacles { obstacles: Array<{ what_blocks_learners: string; common_misconception: string }> }
interface ResearchPrereqs { prerequisites: string[]; assume_none_needed: boolean }

interface TopicListResult {
  level_title: string;
  level_description: string;
  learning_objectives: string[];
  subtopics: Array<{ id: string; title: string }>;
  assessment_criteria: string[];
  estimated_hours: number;
}

interface SubtopicExpansion {
  key_concepts: string[];
  practice_type: string;
  objective: string;
}

const EXPECTED_LEARNING_LEVELS = [1, 2, 3, 4, 5] as const;

// Semantic validation for the outline that JSON schema can't express.
// Schema enforces structure ("5 items, each level in enum") but not distribution —
// small models often produce 5 items with duplicates or missed levels.
// This validator drives the repair-retry loop so the model can correct itself.
function validateOutlineLevels(outline: CourseOutline): string[] {
  const issues: string[] = [];
  const got = outline.levels.map((l) => l.level);
  for (const expected of EXPECTED_LEARNING_LEVELS) {
    const matches = got.filter((g) => Math.abs(g - expected) < 0.01);
    if (matches.length === 0) {
      issues.push(`missing level ${expected} — outline must have exactly one entry for each of [${EXPECTED_LEARNING_LEVELS.join(", ")}]`);
    } else if (matches.length > 1) {
      issues.push(`duplicate level ${expected} appears ${matches.length}× — each level value must appear exactly once`);
    }
  }
  return issues;
}

function renderOutlineAsMarkdown(outline: CourseOutline): string {
  const lines: string[] = ["# Strategic Course Outline", ""];
  for (const lvl of outline.levels) {
    lines.push(`## Level ${lvl.level} — ${lvl.title}`);
    lines.push("");
    lines.push(`**Focus areas:** ${lvl.focus_areas.join("; ")}`);
    lines.push(`**Key outcomes:** ${lvl.key_outcomes.join("; ")}`);
    lines.push(`**Bridge to next:** ${lvl.bridge}`);
    lines.push("");
  }
  lines.push(`## Level 6 — Mastery Exam`);
  lines.push("");
  lines.push(`**Domains tested:** ${outline.mastery_exam.domains.join("; ")}`);
  lines.push(`**Synthesis skills:** ${outline.mastery_exam.synthesis_skills.join("; ")}`);
  lines.push(`**Scenarios:** ${outline.mastery_exam.scenarios.join("; ")}`);
  return lines.join("\n");
}

export function findOutlineLevel(outline: CourseOutline, level: number): OutlineLevel | null {
  return outline.levels.find((l) => Math.abs(l.level - level) < 0.01) ?? null;
}

// ─── Concept ledger ───────────────────────────────────────────────────────────
// A running record of what each level introduced. Read by future levels' prompts
// so small models have explicit memory of prior coverage. Stored as JSON string
// at tutor_instructions[concept_ledger]. Bounded by per-array caps + ~11 entries.

const LEDGER_CAPS = { introduced: 8, vocabulary: 6, skills: 4 } as const;

export async function getConceptLedger(courseId: string): Promise<ConceptLedger> {
  const raw = await getTutorInstruction(courseId, "concept_ledger");
  if (!raw) return { version: 1, by_level: [] };
  try {
    const parsed = JSON.parse(raw) as ConceptLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.by_level)) {
      return { version: 1, by_level: [] };
    }
    return parsed;
  } catch {
    log.warn("getConceptLedger", "Corrupted ledger JSON — resetting");
    return { version: 1, by_level: [] };
  }
}

export async function getCourseOutlineStruct(courseId: string): Promise<CourseOutline | null> {
  const raw = await getTutorInstruction(courseId, "course_outline_json");
  if (!raw) return null;
  try { return JSON.parse(raw) as CourseOutline; }
  catch { return null; }
}

// Append (or replace, on regenerate) the ledger entry for this level.
// Derives concepts from the syllabus, skills/bridge from the outline.
export async function recordLedgerEntry(courseId: string, syllabus: Syllabus): Promise<void> {
  const ledger = await getConceptLedger(courseId);
  const outline = await getCourseOutlineStruct(courseId);
  const outlineLevel = outline ? findOutlineLevel(outline, syllabus.level) : null;

  // Dedupe new concepts against everything introduced in prior levels
  const seen = new Set<string>();
  for (const e of ledger.by_level) {
    if (Math.abs(e.level - syllabus.level) < 0.01) continue; // skip current level on regen
    for (const c of e.introduced) seen.add(c.toLowerCase().trim());
  }

  const introduced: string[] = [];
  for (const subtopic of syllabus.subtopics) {
    for (const concept of subtopic.key_concepts) {
      const key = concept.toLowerCase().trim();
      if (key && !seen.has(key)) {
        introduced.push(concept);
        seen.add(key);
        if (introduced.length >= LEDGER_CAPS.introduced) break;
      }
    }
    if (introduced.length >= LEDGER_CAPS.introduced) break;
  }

  const vocabulary = syllabus.subtopics.map((s) => s.title).slice(0, LEDGER_CAPS.vocabulary);
  const skills = (outlineLevel?.key_outcomes ?? syllabus.learning_objectives).slice(0, LEDGER_CAPS.skills);
  const bridge_out = outlineLevel?.bridge ?? "";

  const entry: LevelLedgerEntry = {
    level: syllabus.level,
    title: syllabus.title,
    introduced,
    vocabulary,
    skills,
    bridge_out,
  };

  const idx = ledger.by_level.findIndex((e) => Math.abs(e.level - syllabus.level) < 0.01);
  if (idx >= 0) ledger.by_level[idx] = entry;
  else ledger.by_level.push(entry);
  ledger.by_level.sort((a, b) => a.level - b.level);

  const serialized = JSON.stringify(ledger);
  await saveTutorInstruction(courseId, "concept_ledger", serialized);
  log.info(
    "recordLedgerEntry",
    `L${syllabus.level} +${introduced.length} new concepts; ledger ${ledger.by_level.length} entries, ${serialized.length}B`,
  );
}

// Compact ledger snapshot for prompt injection.
// Strategy: last 2 levels verbatim (rich detail) + one-line digest of older levels (titles only).
// Returns "" if ledger empty.
// Tier-aware: tiny/small tier drops the older-levels digest entirely and keeps only the most
// recent level verbatim — small models drown in context, so we keep just what's load-bearing.
export function buildLedgerSnapshot(ledger: ConceptLedger, currentLevel: number, tier: ModelTier = "medium"): string {
  const prior = ledger.by_level.filter((e) => e.level < currentLevel);
  if (prior.length === 0) return "";

  const compact = tier === "tiny" || tier === "small";
  const recent = compact ? prior.slice(-1) : prior.slice(-2);
  const older = compact ? [] : prior.slice(0, -2);

  const lines: string[] = ["## What the student has already covered"];

  if (older.length > 0) {
    const titles = older.map((e) => `L${e.level} ${e.title}`).join("; ");
    lines.push(`Earlier levels: ${titles}.`);
  }

  for (const e of recent) {
    lines.push(`Level ${e.level} — ${e.title}`);
    if (e.introduced.length > 0) lines.push(`  Concepts introduced: ${e.introduced.join(", ")}`);
    if (e.skills.length > 0) lines.push(`  Skills: ${e.skills.join("; ")}`);
    if (e.bridge_out) lines.push(`  Bridge into next: ${e.bridge_out}`);
  }

  return lines.join("\n");
}

const LEVEL_MEANINGS: Record<number, string> = {
  1: "Foundations — core terminology and absolute basics, no prior knowledge assumed",
  2: "Working knowledge — handles standard problems with the basics",
  3: "Intermediate — connects concepts across the subject's domains",
  4: "Advanced — designs solutions, identifies edge cases and trade-offs",
  5: "Expert — deep understanding, handles novel problems",
  6: "Mastery — synthesis assessment across all prior levels",
};

export function getLevelMeaning(level: number): string {
  return LEVEL_MEANINGS[level] ?? "Unknown level";
}

// Phase 1: Research the topic via 5 small structured sub-calls + code-assembly.
//
// Why decomposed: a single 2–4k-char free-text research call on small models
// (gemma3:4b, gemma4:e4b) tends to produce shallow/rambling output, which then
// poisons every downstream prompt that slices it for grounding context. Five
// small schema-enforced calls each fit comfortably in an e4b context and
// produce reliable structured data we can render into the same brief shape
// downstream consumers (generateTutorInstructions, generateCourseOutline,
// buildTopicListPrompt) already slice.
//
// Sequential on Ollama (single-GPU swap cost), Promise.all on cloud APIs.
export async function researchTopic(topic: string, config: LLMConfig, onChunk?: (t: string) => void, searchContext?: string): Promise<string> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier; // memoize on the caller's config so downstream stages reuse it
  log.info("researchTopic", `Researching "${topic}" via 5 structured sub-calls (${config.provider}/${config.model}, tier=${tier})`);

  // Tiny/small tiers get a shorter search preamble to leave context headroom for the actual instructions.
  const searchCap = tier === "tiny" || tier === "small" ? 800 : 2000;
  const searchPreamble = searchContext
    ? `Real-world reference material gathered for "${topic}":\n---\n${searchContext.slice(0, searchCap)}\n---\nGround your output in this where it helps.\n\n`
    : "";

  // Stage runners — each one is a single schema-enforced call.
  const runOverview = async (): Promise<ResearchOverview> => {
    onChunk?.(`[research/overview] Subject overview & mastery unlocks...\n`);
    return await callLLMStructured<ResearchOverview>(
      [{ role: "user", content: `${searchPreamble}Describe the subject "${topic}" for a curriculum designer.

- what_it_is: 1–2 sentences defining "${topic}" precisely.
- why_important: 1–2 sentences on why someone should learn this — real-world stakes, what mastery enables.
- mastery_unlocks: 3–5 concrete capabilities a master of "${topic}" gains (e.g., "design distributed systems that handle 1M+ users").

${MATH_FORMATTING_RULES}` }],
      config,
      { schema: RESEARCH_OVERVIEW_SCHEMA, toolName: "emit_subject_overview", tier, onProgress: (m) => onChunk?.(`[research/overview] ${m}\n`) },
    );
  };

  const runDomains = async (): Promise<ResearchDomains> => {
    onChunk?.(`[research/domains] Knowledge domains...\n`);
    return await callLLMStructured<ResearchDomains>(
      [{ role: "user", content: `${searchPreamble}List the 4–7 major knowledge domains within "${topic}".

For each domain:
- name: short identifier (e.g., "Syntax", "Data Structures", "Concurrency")
- focus: 1 sentence on what this domain covers and why it's its own discipline within "${topic}".

Pick domains that a university or professional curriculum would actually treat as distinct strands.

${MATH_FORMATTING_RULES}` }],
      config,
      { schema: RESEARCH_DOMAINS_SCHEMA, toolName: "emit_knowledge_domains", tier, onProgress: (m) => onChunk?.(`[research/domains] ${m}\n`) },
    );
  };

  const runProgression = async (): Promise<ResearchProgression> => {
    onChunk?.(`[research/progression] Learning progression...\n`);
    return await callLLMStructured<ResearchProgression>(
      [{ role: "user", content: `Describe the standard learning progression for "${topic}" as exactly 6 stages, one for each of these stage values, in order:
  beginner, foundations, working_knowledge, intermediate, advanced, mastery

For each stage:
- stage: one of the 6 values above
- milestones: 2–4 specific things a learner achieves at this stage
- can_build: 1 sentence describing what someone at this stage can actually BUILD or DO (not just "understand")

${MATH_FORMATTING_RULES}` }],
      config,
      { schema: RESEARCH_PROGRESSION_SCHEMA, toolName: "emit_progression", tier, onProgress: (m) => onChunk?.(`[research/progression] ${m}\n`) },
    );
  };

  const runObstacles = async (): Promise<ResearchObstacles> => {
    onChunk?.(`[research/obstacles] Common obstacles & misconceptions...\n`);
    return await callLLMStructured<ResearchObstacles>(
      [{ role: "user", content: `Identify the 3–5 most common obstacles learners hit when learning "${topic}".

For each obstacle:
- what_blocks_learners: 1 sentence on the specific blocker (e.g., "Confusing pointers with references")
- common_misconception: 1 sentence on the false belief that drives the blocker

Draw on real teaching experience — these should be things a senior instructor would recognize immediately.

${MATH_FORMATTING_RULES}` }],
      config,
      { schema: RESEARCH_OBSTACLES_SCHEMA, toolName: "emit_obstacles", tier, onProgress: (m) => onChunk?.(`[research/obstacles] ${m}\n`) },
    );
  };

  const runPrereqs = async (): Promise<ResearchPrereqs> => {
    onChunk?.(`[research/prereqs] Prerequisite knowledge...\n`);
    return await callLLMStructured<ResearchPrereqs>(
      [{ role: "user", content: `What knowledge should a learner have before starting "${topic}"?

- prerequisites: list of 0–6 prerequisite areas (concrete things like "basic algebra", "command-line familiarity")
- assume_none_needed: true if this is a true zero-prior-knowledge subject; false otherwise

Be honest. If "${topic}" genuinely assumes no prior knowledge (e.g., "Introduction to Music"), set assume_none_needed to true and leave prerequisites empty.

${MATH_FORMATTING_RULES}` }],
      config,
      { schema: RESEARCH_PREREQS_SCHEMA, toolName: "emit_prerequisites", tier, onProgress: (m) => onChunk?.(`[research/prereqs] ${m}\n`) },
    );
  };

  // Sequential on Ollama (single GPU); parallel on cloud APIs.
  let overview: ResearchOverview, domains: ResearchDomains, progression: ResearchProgression, obstacles: ResearchObstacles, prereqs: ResearchPrereqs;
  if (config.provider === "ollama") {
    overview = await runOverview();
    domains = await runDomains();
    progression = await runProgression();
    obstacles = await runObstacles();
    prereqs = await runPrereqs();
  } else {
    [overview, domains, progression, obstacles, prereqs] = await Promise.all([
      runOverview(), runDomains(), runProgression(), runObstacles(), runPrereqs(),
    ]);
  }

  // ── Code-assemble into the markdown brief shape downstream prompts already slice ──
  // Subject overview lands first because generateTutorInstructions / buildTopicListPrompt
  // slice the first ~1200 chars — keep the load-bearing content at the top.
  const lines: string[] = [];
  lines.push(`# Curriculum Research Brief — ${topic}`);
  lines.push("");
  lines.push("## Subject Overview");
  lines.push(overview.what_it_is);
  lines.push("");
  lines.push(`**Why it matters:** ${overview.why_important}`);
  lines.push("");
  lines.push(`**Mastery unlocks:** ${overview.mastery_unlocks.join("; ")}`);
  lines.push("");
  lines.push("## Key Knowledge Domains");
  for (const d of domains.domains) {
    lines.push(`- **${d.name}** — ${d.focus}`);
  }
  lines.push("");
  lines.push("## Learning Progression (Beginner → Mastery)");
  for (const s of progression.stages) {
    lines.push(`**${s.stage}** — Milestones: ${s.milestones.join("; ")}. Can build: ${s.can_build}`);
  }
  lines.push("");
  lines.push("## Common Learning Obstacles");
  for (const o of obstacles.obstacles) {
    lines.push(`- ${o.what_blocks_learners} _(Misconception: ${o.common_misconception})_`);
  }
  lines.push("");
  lines.push("## Prerequisite Knowledge");
  if (prereqs.assume_none_needed || prereqs.prerequisites.length === 0) {
    lines.push("None — this course assumes no prior knowledge.");
  } else {
    for (const p of prereqs.prerequisites) lines.push(`- ${p}`);
  }

  const brief = lines.join("\n");
  onChunk?.(`[research] ✓ Brief assembled (${brief.length} chars from 5 structured sub-calls).\n`);
  log.info("researchTopic", `Got ${brief.length} char brief from 5 structured sub-calls`);
  return brief;
}

// Generate tutor pedagogy + rules informed by research. (Phase 4b: tutor IDENTITY is no longer
// generated here — it now comes from the chosen sprite persona via buildSystemPrompt's identity slot.)
export async function generateTutorInstructions(
  courseId: string,
  topic: string,
  researchBrief: string,
  config: LLMConfig,
  onChunk?: (t: string) => void,
): Promise<void> {
  const contextSnippet = researchBrief.slice(0, 1200); // First 1200 chars for context

  // Phase 4b: identity (name + personality) is supplied by the chosen sprite persona and overrides the
  // identity slot in buildSystemPrompt. Generating one here was redundant (always overridden) + an extra
  // LLM call, so it's removed. We still generate persona-independent pedagogy + rules below.
  const pedagogyPrompt = `Based on this curriculum research about "${topic}":
---
${contextSnippet}
---

Write a pedagogy instruction (2-3 paragraphs) for a ${topic} tutor. Define:
- The primary teaching approach best suited for this subject (e.g., examples-first for programming, Socratic for math, immersion for languages)
- How to structure explanations at different levels
- When to use analogies vs formal definitions vs hands-on practice
- How to handle confusion and build on what the student already knows

Write in second person ("You should..."). Keep it actionable.

${MATH_FORMATTING_RULES_PROSE}`;

  const pedagogy = onChunk
    ? await callLLMStreaming([{ role: "user", content: pedagogyPrompt }], config, onChunk)
    : await callLLM([{ role: "user", content: pedagogyPrompt }], config);
  await saveTutorInstruction(courseId, "pedagogy", pedagogy);

  const rules = `You are a focused tutor. Follow these rules:
- Stay within the current level's syllabus scope. Don't introduce higher-level concepts unprompted.
- Guide the student to discover answers rather than giving them immediately.
- When stuck, give hints — not full solutions.
- Reference the current level's specific subtopics and objectives when relevant.
- If asked about something beyond scope, acknowledge their curiosity and note it's a great question for a later level.
- Celebrate genuine understanding, not just completion.
- When you see the student has mastered a subtopic, say so explicitly.
- Never give answers during quiz/assessment mode.
- Math formatting: simple symbols can be written as plain text (× ÷ ² ³ π ≤ ≥ √ Δ θ α). For fractions, exponents, roots, sums, integrals, or vectors, write LaTeX inside math delimiters — inline $...$ or block $$...$$ (both render for the student). When a math.render tool is available, prefer it for a standalone equation. Always close every $ you open; never leave a half-open $ or a bare backslash command sitting outside delimiters.`;

  await saveTutorInstruction(courseId, "rules", rules);

  // Store the full research brief for use in future syllabus generation
  await saveTutorInstruction(courseId, "research", researchBrief);
}

// Phase 2.5: Generate a strategic 5-level course outline (+ mastery exam) before individual syllabuses.
// Schema-enforced: outline is JSON, persisted both as JSON (canonical) and markdown (human-readable).
// Returns the markdown rendering for back-compat with existing callers that pass it as context.
export async function generateCourseOutline(
  topic: string,
  researchBrief: string,
  config: LLMConfig,
  courseId: string,
  onChunk?: (t: string) => void,
): Promise<string> {
  const researchSnippet = researchBrief.slice(0, 2000);

  const tierForFewShot = config.modelTier ?? "medium";
  const fewShot = (tierForFewShot === "tiny" || tierForFewShot === "small")
    ? `\nExample of ONE level entry (your real output must contain ALL 5 levels for a course on "${topic}", not this example):
{
  "level": 2,
  "title": "Working with Vectors",
  "focus_areas": ["Vector representation", "Vector operations (add/subtract/scale)", "Dot product", "Geometric visualization"],
  "key_outcomes": ["Manipulate vectors algebraically and geometrically", "Use dot product to test orthogonality"],
  "bridge": "Vector operations set up matrix operations as a natural extension into Level 3."
}\n`
    : "";

  const prompt = `You are a master curriculum architect designing a strategic course on "${topic}".

Research context:
---
${researchSnippet}
---${fewShot}

Produce a structured course outline with EXACTLY 5 learning levels plus a mastery exam.

CRITICAL — the "levels" array MUST contain exactly 5 entries, ONE for each of these "level" values, in order, with no duplicates and no omissions:
  1, 2, 3, 4, 5

Level 1 is the absolute first step (no prior knowledge assumed). Do NOT skip it. The course is intentionally compact — leave deeper specializations to "beyond the course" learning.

For each learning level (entry in the levels array):
- level: one of the 5 values above
- title: specific and descriptive (not generic like "Introduction")
- focus_areas: 3-5 specific topics or skills exclusive to this level
- key_outcomes: 2-3 concrete things the student can DO after this level
- bridge: one sentence on how this connects to the next level

For the mastery exam (separate "mastery_exam" object — Level 6, exam-only, no new content):
- domains: ALL major domains from all 5 learning levels that must appear in the test
- synthesis_skills: 3-4 cross-level synthesis skills
- scenarios: 2-3 real-world application scenarios

Each level builds sequentially from the previous. No gaps. No repeats. Foundations-to-expert coverage in 5 deliberate steps, with mastery synthesis at level 6.

${MATH_FORMATTING_RULES}`;

  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;
  log.info("generateCourseOutline", `Planning strategic outline for "${topic}" via structured output (tier=${tier})`);
  onChunk?.(`[outline] Requesting structured 5-level + mastery-exam plan...\n`);

  const outline = await callLLMStructured<CourseOutline>(
    [{ role: "user", content: prompt }],
    config,
    {
      schema: OUTLINE_SCHEMA,
      toolName: "emit_course_outline",
      validate: validateOutlineLevels,
      tier,
      onProgress: (msg) => onChunk?.(`[outline] ${msg}\n`),
    },
  );

  // Persist BOTH formats:
  //  - course_outline_json: canonical machine-readable, consumed by syllabus generation
  //  - course_outline: markdown rendering, kept for chat-time references and human inspection
  await saveTutorInstruction(courseId, "course_outline_json", JSON.stringify(outline));
  const markdown = renderOutlineAsMarkdown(outline);
  await saveTutorInstruction(courseId, "course_outline", markdown);

  onChunk?.(`[outline] Built ${outline.levels.length} levels + mastery exam.\n`);
  log.info("generateCourseOutline", `Outline generated: ${outline.levels.length} levels, ${markdown.length} char markdown`);
  return markdown;
}

// Phase 4: Generate a syllabus level via two-stage structured pipeline.
//
//   Stage A — Topic list call (schema-enforced): pick 3-6 subtopic titles + level metadata
//   Stage B — Per-subtopic expansion calls (schema-enforced): for each subtopic, return
//             {key_concepts, practice_type, objective}. Sequential on Ollama (single GPU),
//             Promise.all on cloud APIs.
//   Stage C — Code-assemble Syllabus, save via existing saveSyllabus.
//
// Level 6 (mastery exam) is code-assembled from outline.mastery_exam — no topic-list LLM
// call needed. Stage-A is synthesized directly from the outline's mastery_exam structure.
//
// Failure policy: hybrid — clamp first failed subtopic to a safe default; abort on second.
// Public signature unchanged so existing callers in Dashboard.tsx and CourseView.tsx don't move.
export async function generateSyllabus(
  courseId: string,
  topic: string,
  level: number,
  config: LLMConfig,
  researchBrief: string = "",
  onChunk?: (t: string) => void,
  _previousSyllabuses?: Syllabus[],  // ignored — superseded by concept ledger
  _courseOutline?: string,           // ignored — read course_outline_json from DB
): Promise<Syllabus> {
  const isMastery = level >= 6;

  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  const outline = await getCourseOutlineStruct(courseId);
  if (!outline) {
    throw new Error(`Cannot generate syllabus for level ${level}: structured course outline not found. Re-run outline generation.`);
  }

  const outlineLevel = isMastery ? null : findOutlineLevel(outline, level);
  if (!isMastery && !outlineLevel) {
    const got = outline.levels.map((l) => String(l.level)).join(", ");
    throw new Error(
      `Course outline missing a plan for Level ${level}. ` +
      `Outline contains: [${got}]. Re-run course generation — outline gen produced an incomplete plan.`,
    );
  }

  const ledger = await getConceptLedger(courseId);
  const snapshot = buildLedgerSnapshot(ledger, level, tier);

  // ── Stage A: Topic list ────────────────────────────────────────────────────
  let topicResult: TopicListResult;
  if (isMastery) {
    // No LLM call — synthesize directly from outline.mastery_exam
    const me = outline.mastery_exam;
    const subtopicCount = Math.min(me.domains.length, 6);
    topicResult = {
      level_title: `Mastery Exam — ${topic}`,
      level_description: `Comprehensive synthesis assessment covering all 5 prior learning levels. No new content — tests transfer and integration across ${me.domains.length} domains via real-world scenarios.`,
      learning_objectives: me.synthesis_skills.slice(0, 5),
      subtopics: me.domains.slice(0, subtopicCount).map((d, i) => ({
        id: `6.${i + 1}`,
        title: d.length > 80 ? d.slice(0, 77) + "..." : d,
      })),
      assessment_criteria: me.scenarios.slice(0, 4),
      estimated_hours: 8,
    };
    onChunk?.(`[L${level}] Mastery exam structure derived from outline (${topicResult.subtopics.length} domains, 0 LLM calls).\n`);
  } else {
    onChunk?.(`[L${level}] Topic list...\n`);
    const topicPrompt = buildTopicListPrompt(topic, level, outlineLevel!, researchBrief, snapshot, tier);
    topicResult = await callLLMStructured<TopicListResult>(
      [{ role: "user", content: topicPrompt }],
      config,
      {
        schema: TOPIC_LIST_SCHEMA,
        toolName: "emit_level_topics",
        tier,
        onProgress: (m) => onChunk?.(`[L${level} topic-list] ${m}\n`),
      },
    );
    onChunk?.(`[L${level}] Topic list → ${topicResult.subtopics.length} subtopics.\n`);
  }

  // ── Stage B: Per-subtopic expansion ────────────────────────────────────────
  const expansions = await expandSubtopics(
    topicResult.subtopics,
    topic,
    level,
    outlineLevel,
    snapshot,
    config,
    tier,
    onChunk,
  );

  // ── Stage C: Code-assemble + persist ───────────────────────────────────────
  const subtopics: Subtopic[] = topicResult.subtopics.map((t, i) => ({
    id: t.id,
    title: t.title,
    key_concepts: expansions[i].key_concepts,
    practice_type: expansions[i].practice_type,
    mastered: false,
  }));

  const syllabus: Omit<Syllabus, "id" | "generated_at"> = {
    course_id: courseId,
    level,
    title: topicResult.level_title,
    description: topicResult.level_description,
    learning_objectives: topicResult.learning_objectives,
    subtopics,
    assessment_criteria: topicResult.assessment_criteria,
    estimated_hours: topicResult.estimated_hours,
  };

  await saveSyllabus(syllabus);
  onChunk?.(`[L${level}] ✓ Syllabus saved.\n`);
  log.info("generateSyllabus", `L${level} saved: ${subtopics.length} subtopics`);

  return { ...syllabus, id: "", generated_at: new Date().toISOString() } as Syllabus;
}

// ─── Lessons (slice A1) ───────────────────────────────────────────────────────
// A short, readable lesson for ONE subtopic — the missing middle between the syllabus and chat.
// Generated on demand and cached in the `lessons` table. Decomposed (summary + sections + takeaways)
// and schema-enforced so it's reliable on the floor model; code-assembled into markdown that renders
// via renderChatMarkdown. Plain-text math only (keeps the structured JSON clean — no LaTeX in strings).
// LessonContent + assembleLessonMarkdown are the pure assembly half (lesson-format.ts).

const LESSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "key_takeaways"],
  properties: {
    summary: { type: "string", minLength: 30, maxLength: 600 },
    sections: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: {
          heading: { type: "string", minLength: 3, maxLength: 80 },
          body: { type: "string", minLength: 60, maxLength: 1200 },
        },
      },
    },
    key_takeaways: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", minLength: 8, maxLength: 200 } },
  },
};

function buildLessonPrompt(topic: string, level: number, subtopic: { title: string; key_concepts: string[] }): string {
  const concepts = subtopic.key_concepts.length ? subtopic.key_concepts.join(", ") : subtopic.title;
  return `Write a short, clear lesson that teaches ONE subtopic of a course on "${topic}".

## Subtopic
- Title: ${subtopic.title}
- Key concepts to cover: ${concepts}
- Difficulty: ${getLevelMeaning(level)}

## How to write it
- summary: 2-3 sentences introducing what this subtopic is and why it matters.
- sections: 2-4 short teaching sections, each a heading + 1-2 short paragraphs. Explain directly, build
  from simpler to harder, and include at least one concrete worked example.
- key_takeaways: 2-5 one-line points worth remembering.
- Write for a motivated beginner: concrete, encouraging, no fluff. Do NOT include quiz questions.

${MATH_FORMATTING_RULES}`;
}

// Generate + persist a lesson for a subtopic. On-demand; the caller caches by checking getLessons first.
export async function generateLesson(
  courseId: string,
  level: number,
  subtopic: { id: string; title: string; key_concepts: string[] },
  topic: string,
  config: LLMConfig,
  onProgress?: (m: string) => void,
): Promise<Lesson> {
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  const result = await callLLMStructured<LessonContent>(
    [{ role: "user", content: buildLessonPrompt(topic, level, subtopic) }],
    config,
    { schema: LESSON_SCHEMA, toolName: "emit_lesson", tier, onProgress: (m) => onProgress?.(m) },
  );

  const content = assembleLessonMarkdown(subtopic.title, result);
  const lesson = await createLesson(courseId, level, subtopic.title, content, subtopic.id);
  log.info("generateLesson", `L${level} "${subtopic.title}" → ${content.length} chars`);
  return lesson;
}

function buildTopicListPrompt(
  topic: string,
  level: number,
  outlineLevel: OutlineLevel,
  researchBrief: string,
  ledgerSnapshot: string,
  tier: ModelTier = "medium",
): string {
  // Tiny/small tier: halve the research snippet to leave context for the actual instructions.
  const researchCap = tier === "tiny" || tier === "small" ? 600 : 1200;
  const research = researchBrief ? `\n## Research context (excerpt)\n${researchBrief.slice(0, researchCap)}\n` : "";
  const ledger = ledgerSnapshot ? `\n${ledgerSnapshot}\n` : "";
  // Few-shot example for tiny/small tier — small models do dramatically better with one concrete example.
  const fewShot = (tier === "tiny" || tier === "small")
    ? `\n## Example output shape (for a DIFFERENT topic — illustrates format only)
{
  "level_title": "Linear Algebra — Working with Vectors",
  "level_description": "Build fluency with vector representation, operations, and the geometric intuition behind them. Students leave this level able to translate between algebraic and geometric formulations.",
  "learning_objectives": [
    "Add, subtract, and scale vectors in 2D and 3D",
    "Compute and interpret the dot product geometrically and algebraically",
    "Visualize vectors and operations on a coordinate plane"
  ],
  "subtopics": [
    { "id": "2.1", "title": "Vector representation and notation" },
    { "id": "2.2", "title": "Vector addition and scalar multiplication" },
    { "id": "2.3", "title": "Dot product — algebraic and geometric forms" },
    { "id": "2.4", "title": "Visualization on the coordinate plane" }
  ],
  "assessment_criteria": [
    "Student can manipulate vectors symbolically and graphically",
    "Student articulates when the dot product is positive/negative/zero"
  ],
  "estimated_hours": 8
}\n`
    : "";
  return `Design the topic list for Level ${level} of a course on "${topic}".${fewShot}

## This level's plan (from the course outline — follow it)
- Title direction: ${outlineLevel.title}
- Focus areas: ${outlineLevel.focus_areas.join("; ")}
- Key outcomes: ${outlineLevel.key_outcomes.join("; ")}
- Bridge to next level: ${outlineLevel.bridge}
${ledger}${research}
## Difficulty target
${getLevelMeaning(level)}

## Requirements
- 3-6 subtopics. Each subtopic title must align with one or more focus areas above.
- Do NOT repeat concepts already introduced in earlier levels (see ledger above).
- Subtopic IDs follow the pattern "${level}.1", "${level}.2", etc.
- Estimated hours: 4-12, scaled to level complexity.
- learning_objectives must be specific and measurable.
- assessment_criteria describe what a passing student can do.

${MATH_FORMATTING_RULES}`;
}

function buildExpansionPrompt(
  topic: string,
  level: number,
  subtopic: { id: string; title: string },
  outlineLevel: OutlineLevel | null,
  ledgerSnapshot: string,
  _tier: ModelTier = "medium",
): string {
  // tier currently unused here (prompt is already short); reserved for future few-shot injection.
  void _tier;
  const ctx = outlineLevel
    ? `Level ${level} focus areas: ${outlineLevel.focus_areas.join("; ")}.\nLevel outcomes: ${outlineLevel.key_outcomes.join("; ")}.`
    : `This is the Level 6 mastery exam — tests synthesis across all 5 prior learning levels with no new content.`;
  const ledger = ledgerSnapshot ? `\n${ledgerSnapshot}\n` : "";
  return `Design ONE subtopic for a course on "${topic}", Level ${level} (${getLevelMeaning(level)}).

## Subtopic
"${subtopic.title}" (id ${subtopic.id})

## Context
${ctx}${ledger}

## Requirements
- 2-4 key_concepts the student must master in this subtopic. Concrete, named, level-appropriate.
- practice_type: pick the best fit — code_exercise, reading, discussion, guided_project, debugging_exercise, problem_set.
- objective: ONE sentence describing what the student will be able to DO after working this subtopic.

${MATH_FORMATTING_RULES}`;
}

async function expandSubtopics(
  topicList: Array<{ id: string; title: string }>,
  topic: string,
  level: number,
  outlineLevel: OutlineLevel | null,
  snapshot: string,
  config: LLMConfig,
  tier: ModelTier,
  onChunk?: (t: string) => void,
): Promise<SubtopicExpansion[]> {
  const fallbackConcept = outlineLevel?.focus_areas[0] ?? topic;
  const safeDefault = (sub: { id: string; title: string }): SubtopicExpansion => ({
    key_concepts: [fallbackConcept, sub.title],
    practice_type: "discussion",
    objective: `Discuss and explore ${sub.title} in the context of ${topic}.`,
  });

  const expandOne = async (sub: { id: string; title: string }, idx: number): Promise<SubtopicExpansion> => {
    onChunk?.(`[L${level}] Expanding ${idx + 1}/${topicList.length}: ${sub.title}\n`);
    const prompt = buildExpansionPrompt(topic, level, sub, outlineLevel, snapshot, tier);
    return await callLLMStructured<SubtopicExpansion>(
      [{ role: "user", content: prompt }],
      config,
      {
        schema: EXPANSION_SCHEMA,
        toolName: "emit_subtopic_expansion",
        tier,
      },
    );
  };

  // Cloud APIs: run expansion calls in parallel. Ollama: sequential (single-GPU swap cost).
  const sequential = config.provider === "ollama";
  const results: SubtopicExpansion[] = new Array(topicList.length);
  let failures = 0;

  const handleFailure = (idx: number, sub: { id: string; title: string }, reason: unknown): SubtopicExpansion => {
    failures++;
    if (failures === 1) {
      onChunk?.(`[L${level}] ⚠ Subtopic ${idx + 1}/${topicList.length} "${sub.title}" used safe defaults (model failed). Reason: ${reason instanceof Error ? reason.message : String(reason)}\n`);
      log.warn("expandSubtopics", `clamp on first failure`, { level, subtopic: sub.title, reason });
      return safeDefault(sub);
    }
    throw new Error(
      `Two or more subtopic expansions failed in Level ${level} — aborting. Most recent: "${sub.title}". ` +
      `Reason: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  };

  if (sequential) {
    for (let i = 0; i < topicList.length; i++) {
      try {
        results[i] = await expandOne(topicList[i], i);
      } catch (e) {
        results[i] = handleFailure(i, topicList[i], e);
      }
    }
  } else {
    const settled = await Promise.allSettled(topicList.map((s, i) => expandOne(s, i)));
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled") {
        results[i] = s.value;
      } else {
        results[i] = handleFailure(i, topicList[i], s.reason);
      }
    }
  }

  return results;
}

// Static fallback identity for the rare course with neither a sprite persona nor a stored generated
// identity (Phase 4b stopped generating the latter). New courses always have a sprite; legacy courses
// keep their stored identity — so this is purely defensive, never an LLM call.
const DEFAULT_TUTOR_IDENTITY =
  "You are a knowledgeable, encouraging tutor. Explain clearly, adapt to the student's level, and keep them motivated.";

export function buildSystemPrompt(
  instructions: Record<string, string>,
  syllabus: Syllabus | null,
  courseLevel: number,
  topic: string,
  modePromptSuffix?: string,
  knowledgeSummary?: string,
  personaIdentity?: string,
): string {
  const parts: string[] = [];

  // Phase 4b: a chosen persona overrides ONLY this identity slot (name + tone). Pedagogy, rules,
  // progress, and the syllabus still come from the generated tutor_instructions — keeping the WHO
  // axis orthogonal to HOW/WHAT. No persona (legacy course / skipped pick) falls back to the
  // generated identity, so existing courses render byte-identical.
  const identity = personaIdentity ?? instructions.identity ?? DEFAULT_TUTOR_IDENTITY;
  if (identity) {
    parts.push(`## Tutor Identity\n${identity}`);
  }
  if (instructions.pedagogy) {
    parts.push(`## Teaching Approach\n${instructions.pedagogy}`);
  }
  if (instructions.rules) {
    parts.push(`## Rules\n${instructions.rules}`);
  }
  if (syllabus) {
    parts.push(`## Current Level: ${syllabus.level} — ${syllabus.title}
${syllabus.description}

### Learning Objectives
${syllabus.learning_objectives.map((o) => `- ${o}`).join("\n")}

### Subtopics in Scope
${syllabus.subtopics.map((s) => `- **${s.title}** (${s.mastered ? "MASTERED ✓" : "in progress"}): ${s.key_concepts.join(", ")}`).join("\n")}

Level: ${getLevelMeaning(courseLevel)}`);
  } else {
    // Fallback when no syllabus exists yet
    parts.push(`## Subject\nYou are tutoring the student on: ${topic}. Help them learn this subject step by step, starting from their current level of understanding.`);
  }
  if (instructions.progress_context) {
    parts.push(`## Student Progress\n${instructions.progress_context}`);
  }
  if (knowledgeSummary) {
    parts.push(`## Student Knowledge\n${knowledgeSummary}`);
  }

  const base = parts.join("\n\n---\n\n");
  return modePromptSuffix ? base + modePromptSuffix : base;
}

// ─── Course generation pipeline with checkpoint/resume ────────────────────────
// Wraps the 9-step pipeline (research → outline → tutor instructions → 6 syllabuses)
// so it can be invoked either from scratch or resumed mid-flight after a failure.
//
// State is updated AFTER each successful step to indicate the NEXT step to run.
// On unhandled throw, the state remains at the in-progress step's name so a future
// resume can pick up there. The course row is NOT deleted on failure — the user
// can hit Resume to continue.

// Sequential names of the pipeline's resumable steps. Order matters — used to
// determine which steps to skip on resume.
const PIPELINE_STEPS = [
  "researching",
  "outlining",
  "instructions",
  "syllabus_L1",
  "syllabus_L2",
  "syllabus_L3",
  "syllabus_L4",
  "syllabus_L5",
  "syllabus_L6",
] as const;

export interface PipelineCallbacks {
  // stepUiIndex is the index within Dashboard.INITIAL_STEPS — pipeline starts at index 2
  // (after preflight=0, create-course=1). Provided so callers can update their step UI.
  onStep?: (uiIndex: number, status: "active" | "done" | "error") => void;
  onChunk?: (chunk: string) => void;
}

export interface RunPipelineOpts extends PipelineCallbacks {
  courseId: string;
  topic: string;
  config: LLMConfig;
  searchContext?: string;
  // null = run from scratch; "completed" = no-op; any pipeline-step name = resume there.
  fromState?: string | null;
}

// UI step offset: the first pipeline step (research) is INITIAL_STEPS[2] in Dashboard.tsx.
const PIPELINE_UI_OFFSET = 2;

export async function runGenerationPipeline(opts: RunPipelineOpts): Promise<void> {
  const { courseId, topic, config, searchContext, fromState, onStep, onChunk } = opts;

  if (fromState === "completed") {
    onChunk?.(`[pipeline] Already completed — nothing to do.\n`);
    return;
  }

  // Detect tier once for the whole run.
  const tier = config.modelTier ?? await detectModelTier(config);
  config.modelTier = tier;

  const startIdx = (() => {
    if (!fromState) return 0;
    const idx = (PIPELINE_STEPS as readonly string[]).indexOf(fromState);
    return idx === -1 ? 0 : idx; // unknown state → restart from beginning
  })();

  const shouldRun = (stepName: string): boolean => {
    const idx = (PIPELINE_STEPS as readonly string[]).indexOf(stepName);
    return idx >= startIdx;
  };

  const advanceTo = async (nextStep: string): Promise<void> => {
    await updateGenerationState(courseId, nextStep);
  };

  const skipMessage = (stepLabel: string) => onChunk?.(`[resume] ✓ Skipping ${stepLabel} (already done).\n`);

  // ── Step 0 (UI index 2): Research ──
  const researchUI = PIPELINE_UI_OFFSET + 0;
  let researchBrief = "";
  if (shouldRun("researching")) {
    await advanceTo("researching");
    onStep?.(researchUI, "active");
    researchBrief = await researchTopic(topic, config, onChunk, searchContext);
    // Persist immediately so resume can read it without re-running 5 sub-calls.
    await saveTutorInstruction(courseId, "research", researchBrief);
    onStep?.(researchUI, "done");
    await advanceTo("outlining");
  } else {
    researchBrief = (await getTutorInstruction(courseId, "research")) ?? "";
    if (!researchBrief) {
      // Previous run never persisted research; safest is to re-run it.
      log.warn("runGenerationPipeline", "Resume found no saved research brief — re-running research step");
      await advanceTo("researching");
      onStep?.(researchUI, "active");
      researchBrief = await researchTopic(topic, config, onChunk, searchContext);
      await saveTutorInstruction(courseId, "research", researchBrief);
      onStep?.(researchUI, "done");
      await advanceTo("outlining");
    } else {
      skipMessage("research");
      onStep?.(researchUI, "done");
    }
  }

  // ── Step 1 (UI index 3): Outline ──
  const outlineUI = PIPELINE_UI_OFFSET + 1;
  if (shouldRun("outlining")) {
    onStep?.(outlineUI, "active");
    await generateCourseOutline(topic, researchBrief, config, courseId, onChunk);
    onStep?.(outlineUI, "done");
    await advanceTo("instructions");
  } else {
    skipMessage("outline");
    onStep?.(outlineUI, "done");
  }

  // ── Step 2 (UI index 4): Tutor instructions ──
  const instructionsUI = PIPELINE_UI_OFFSET + 2;
  if (shouldRun("instructions")) {
    onStep?.(instructionsUI, "active");
    await generateTutorInstructions(courseId, topic, researchBrief, config, onChunk);
    onStep?.(instructionsUI, "done");
    await advanceTo("syllabus_L1");
  } else {
    skipMessage("tutor instructions");
    onStep?.(instructionsUI, "done");
  }

  // ── Steps 3-8 (UI index 5..10): Syllabuses L1..L6 ──
  const SYLLABUS_LEVELS = [1, 2, 3, 4, 5, 6] as const;
  for (let i = 0; i < SYLLABUS_LEVELS.length; i++) {
    const level = SYLLABUS_LEVELS[i];
    const stepName = `syllabus_L${level}`;
    const ui = PIPELINE_UI_OFFSET + 3 + i;

    if (shouldRun(stepName)) {
      onStep?.(ui, "active");
      const syl = await generateSyllabus(courseId, topic, level, config, researchBrief, onChunk);
      await recordLedgerEntry(courseId, syl);
      onStep?.(ui, "done");
      const next = i < SYLLABUS_LEVELS.length - 1 ? `syllabus_L${SYLLABUS_LEVELS[i + 1]}` : "completed";
      await advanceTo(next);
    } else {
      skipMessage(`Level ${level} syllabus`);
      onStep?.(ui, "done");
    }
  }

  // Knowledge files init is idempotent in spirit (saveTutorInstruction upserts), so safe on resume too.
  await initKnowledgeFiles(courseId);

  onChunk?.(`[pipeline] ✓ Generation complete.\n`);
  log.info("runGenerationPipeline", `Course ${courseId} fully generated`);
}
