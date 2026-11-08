// The RAG eval runner (#90) — the device that decides whether the win condition was met.
//
// Runs the fixture vault through the real kernel on the real configured model, once per mechanism:
//   pre-retrieval  — the grounding stage runs before the model sees the turn (retrieval: "always")
//   tool-only      — the old path; the model must choose to call notebook.search (retrieval: "off")
//
// Reports a RATE, not a boolean. One Bernoulli sample cannot distinguish a 25% success rate from a
// 95% one, which is precisely the mistake the single pre-existing RAG golden made.
//
// Runs in the Tauri webview (needs Ollama up, a chat model, and an embedding model):
//     await window.__runRagEval()                      // both mechanisms, 1 repeat
//     await window.__runRagEval({ repeats: 3 })        // the real bar
//     await window.__runRagEval({ modes: ["always"] }) // just the shipping path
//     await window.__runRagEval({ set: "dev", modes: ["always"], repeats: 3 })
//                                                      // held-out split (rag-heldout.ts)
//
// Or from a terminal, against a real local Ollama and with no Tauri app: `npm run eval` (see
// src/lib/eval/headless/README.md). That entry calls THIS function; it only swaps the platform
// (SQLite, HTTP, settings store) underneath the kernel.

import { tutorEngine, EMPTY_GROUNDING, type TutorTurn, type Grounding } from "../kernel";
import type { RetrievalMode } from "../kernel/ground";
import type { TurnKind } from "../kernel/turnKind";
import { registerBuiltinTools, type ToolContext } from "../tools";
import { loadBuiltinSkills, resolveSkill } from "../skills";
import { buildSystemPrompt } from "../curriculum";
import { getChatConfig, getMaxContextTokens } from "../store";
import { detectModelProfile } from "../llm";
import { deleteCourse, ensureCourse } from "../db";
import { importTextAsNote } from "../notebook";
import { evalToolSyllabus } from "./goldens";
import { RAG_FIXTURE, RAG_QUESTIONS, scoreRagAnswer, summarizeRag, type FixtureNote, type RagQuestion, type RagVerdict } from "./rag-fixture";
import { RAG_HELDOUT } from "./rag-heldout";
import { RAG_DEV_V2, RAG_DEV_V2_VAULT, realWorldAnswered } from "./rag-dev-v2";
import type { LLMConfig, Syllabus } from "../../types";

const RAG_COURSE_ID = "__eval_rag__";

// Only ONE run at a time. Both `seedVault` and the teardown mutate a fixed course id, so two
// overlapping runs destroy each other's vault: the first to finish deletes the course the second is
// still reading from, and every subsequent retrieval silently returns library-only hits. That is not
// a hypothetical — it happened on the first real run of this harness and produced a plausible-looking
// 36% that had nothing to do with the model. A silent wrong number is worse than a loud refusal, so
// this refuses.
let inFlight = false;

// Minimal instructions so the system prompt is realistic without dragging in a generated course.
const RAG_INSTRUCTIONS: Record<string, string> = {
  identity: "You are a helpful tutor.",
  pedagogy: "Answer the student's question directly and concisely.",
  rules: "Be accurate. If you do not know something, say so.",
};

export interface RagRow {
  mode: RetrievalMode;
  question: RagQuestion;
  answer: string;
  citedTitles: string[];
  retrievedTitles: string[];
  /** The grounding stage's own trace for this turn (scores, candidate counts, skip reason). */
  retrieval: Grounding["trace"];
  toolCalls: string[];
  verdict: RagVerdict;
  /** B1 (c): for a negative with a real-world answer list (rag-dev-v2.ts realWorldExpect), whether the
   *  answer gave it. Null for every other row. */
  realWorld: boolean | null;
  /** For an item with a gold or near note (`note`), whether that note was among the hits the model saw.
   *  Null when the item names no note (main fixture, sealed far negatives without one). */
  noteRetrieved: boolean | null;
  /** What the turn classifier made of the question (turnKind.ts), reported in both arms, and whether a
   *  turn note was actually appended (false on every row of an EVAL_TURN_NOTES=off run). Null kind on
   *  a turn that threw. */
  turnKind: TurnKind | null;
  turnNoted: boolean;
  /** Milliseconds from the start of the turn to the first streamed text; null when no text came. */
  ttft_ms: number | null;
  /** Milliseconds for the whole turn, grounding and tool calls included. */
  total_ms: number;
}

/** A set that brings its own vault, such as the sealed held-out file (sealed.ts). */
export interface RagCustomSet {
  name: string;
  vault: FixtureNote[];
  questions: RagQuestion[];
}

export interface RagReport {
  model: string;
  provider: string;
  contextTokens: number;
  repeats: number;
  /** "off" when the run sent no turn notes (EVAL_TURN_NOTES=off, the paired baseline arm). */
  turnNotes: "on" | "off";
  /** "main", "dev", "test", "dev-v2", or the name of a custom set (e.g. the sealed held-out file). */
  set: string;
  rows: RagRow[];
  /** mode → kind → { pass, total } */
  byMode: Record<string, Record<string, { pass: number; total: number }>>;
  /** mode → real-world answered over the rows that have a real-world answer list (B1 (c)). */
  realWorld: Record<string, { answered: number; total: number }>;
  /** mode → kind → rows whose item's note was retrieved, over rows whose item names a note. */
  noteRetrieved: Record<string, Record<string, { retrieved: number; total: number }>>;
  /** Whether the pre-committed condition was met (see the console summary for the exact bars). */
  verdict: { positivesPct: number; negativesClean: boolean; meetsBar: boolean };
}

async function seedVault(vault: FixtureNote[]): Promise<void> {
  await deleteCourse(RAG_COURSE_ID); // clear leftovers from a crashed run
  await ensureCourse(RAG_COURSE_ID, "Eval (RAG)", "Eval");
  for (const note of vault) {
    await importTextAsNote({ courseId: RAG_COURSE_ID, title: note.title, sourceType: "note", text: note.text });
  }
}

function matchedSyllabus(): Syllabus {
  const sub = (id: string, title: string, key_concepts: string[]) =>
    ({ id, title, key_concepts, practice_type: "exercises", mastered: false, practiced: false });
  return {
    id: "eval-syl-rag",
    course_id: RAG_COURSE_ID,
    level: 1,
    title: "General Studies",
    description: "A general course: the student brings questions from any subject and keeps notes on what they learn.",
    learning_objectives: ["Answer questions across science, geography, history and economics"],
    subtopics: [
      sub("gs-science", "Science", ["chemistry", "biology", "astronomy", "engineering"]),
      sub("gs-geo", "Geography and History", ["landforms", "documents", "dates"]),
      sub("gs-econ", "Economics and Study Skills", ["ratios", "study plans"]),
    ],
    assessment_criteria: ["Can answer a factual question and say where the answer came from"],
    estimated_hours: 2,
    generated_at: new Date().toISOString(),
  } as Syllabus;
}

export async function runRagEval(opts?: {
  repeats?: number;
  modes?: RetrievalMode[];
  /** One question id, or several separated by commas. */
  only?: string;
  /** "main" (default) is rag-fixture.ts; "dev"/"test" are the held-out splits in rag-heldout.ts;
   *  "dev-v2" is rag-dev-v2.ts, with its own vault. */
  set?: "main" | "dev" | "test" | "dev-v2";
  /** A set that brings its own vault (the sealed held-out file). Replaces `set` and RAG_FIXTURE. */
  custom?: RagCustomSet;
  /** "python" (default): the tool-golden Python syllabus. "matched": a course whose scope covers the
   *  vault's subjects, which is what a learner who wrote these notes would actually be enrolled in. */
  syllabus?: "python" | "matched";
  /** "off": the kernel sends no turn note (TutorTurn.turnNotes), for the paired baseline. Default "on",
   *  which is what the app does. */
  turnNotes?: "on" | "off";
}): Promise<RagReport> {
  if (inFlight) {
    throw new Error(
      "A RAG eval is already running. Wait for it to finish — two runs share one fixture course and " +
      "would delete each other's vault, producing numbers that look real and are not.",
    );
  }
  inFlight = true;

  const repeats = opts?.repeats ?? 1;
  const turnNotes = opts?.turnNotes ?? "on";
  const modes = opts?.modes ?? (["always", "off"] as RetrievalMode[]);
  const set = opts?.custom?.name ?? opts?.set ?? "main";
  const vault = opts?.custom?.vault ?? (set === "dev-v2" ? RAG_DEV_V2_VAULT : RAG_FIXTURE);
  const pool: RagQuestion[] = opts?.custom ? opts.custom.questions
    : set === "main" ? RAG_QUESTIONS : set === "dev-v2" ? RAG_DEV_V2 : RAG_HELDOUT.filter((q) => q.split === set);
  const only = opts?.only ? new Set(opts.only.split(",").map((id) => id.trim()).filter(Boolean)) : null;
  const questions = only ? pool.filter((q) => only.has(q.id)) : pool;
  if (questions.length === 0) {
    inFlight = false;
    throw new Error(`No questions selected (set=${set}${opts?.only ? `, only=${opts.only}` : ""}).`);
  }

  registerBuiltinTools();
  await loadBuiltinSkills();

  // Resolve the window exactly as ChatTab does, so the eval measures the configuration the app runs.
  const baseConfig = await getChatConfig();
  const profile = await detectModelProfile(baseConfig);
  const contextTokens = baseConfig.provider === "ollama"
    ? Math.min(profile.contextTokens, await getMaxContextTokens())
    : profile.contextTokens;
  const config: LLMConfig = { ...baseConfig, modelTier: profile.tier, contextTokens };

  console.log(`[rag-eval] ${config.provider}/${config.model} ctx=${contextTokens} · set=${set} · ${questions.length} question(s) × ${repeats} repeat(s) × ${modes.length} mode(s)`);

  const rows: RagRow[] = [];
  try {
    await seedVault(vault);

    for (const mode of modes) {
      for (let rep = 0; rep < repeats; rep++) {
        for (const question of questions) {
          const skill = resolveSkill("explain") ?? null;
          const system = buildSystemPrompt(RAG_INSTRUCTIONS, (opts?.syllabus === "matched" ? matchedSyllabus() : evalToolSyllabus()), 1, "General Study", skill?.promptSuffix ?? "", undefined, undefined);
          const ctx: ToolContext = {
            courseId: RAG_COURSE_ID,
            level: 1,
            syllabus: (opts?.syllabus === "matched" ? matchedSyllabus() : evalToolSyllabus()),
            modelTier: profile.tier,
            contextTokens,
            permissionMode: "default",
            config,
            abort: new AbortController().signal,
            activeSkill: skill,
            confirmTool: async () => true,
            supportsTools: profile.supportsTools,
          };
          // Timed from here: the kernel's own work (tool selection, grounding, embedding the question)
          // is part of what a learner waits for, so it counts toward ttft.
          let ttft_ms: number | null = null;
          const started = performance.now();
          const turn: TutorTurn = {
            messages: [
              ...(system.trim() ? [{ role: "system", content: system }] : []),
              { role: "user", content: question.ask },
            ],
            config,
            retrieval: mode,
            ...(turnNotes === "off" ? { turnNotes } : {}),
            onText: () => { if (ttft_ms === null) ttft_ms = Math.round(performance.now() - started); },
          };

          let answer = "";
          let citedTitles: string[] = [];
          let retrievedTitles: string[] = [];
          let toolCalls: string[] = [];
          let retrievalTrace: Grounding["trace"] = EMPTY_GROUNDING.trace;
          let turnKind: TurnKind | null = null;
          let turnNoted = false;
          try {
            const result = await tutorEngine.run(turn, ctx);
            answer = result.text;
            turnKind = result.turnKind;
            turnNoted = result.turnNote !== null;
            retrievalTrace = result.grounding.trace;
            // The citation the STUDENT would see — n-gram verified, never the model's claim. In
            // tool-only mode the grounding stage does not run, so a cited title can still arrive via
            // the tool path only if the answer reused its text; that asymmetry is the thing measured.
            citedTitles = [...new Set(result.usedHits.map((h) => h.title))];
            retrievedTitles = result.grounding.trace.hitTitles;
            toolCalls = result.toolCalls.map((c) => c.name);
          } catch (e) {
            answer = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }
          const total_ms = Math.round(performance.now() - started);

          // Integrity check on the VAULT, not on the answer.
          //
          // Reads noteCandidates (pre-floor), not surviving hits. Zero SURVIVORS is the healthy result
          // for a question the vault cannot answer — every negative produces it, and checking hits
          // aborted the run on "Who wrote Hamlet?" with 6 perfectly good candidates sitting at 0.39.
          // Zero CANDIDATES is the pathological case: the notebook returned nothing at all, which
          // means the seeded course is gone and every later row would measure an empty corpus.
          const retrievalRan = retrievalTrace.skipped !== "short-query" && retrievalTrace.skipped !== "disabled";
          if (mode === "always" && retrievalRan && retrievalTrace.noteCandidates === 0) {
            throw new Error(
              `Fixture vault returned NO note candidates at ${question.id} ` +
              `(${retrievalTrace.candidates} total candidate(s), ${retrievalTrace.noteCandidates} from notes` +
              `${retrievalTrace.error ? `, embed error: ${retrievalTrace.error}` : ""}). ` +
              "The seeded course is gone or the embedder is down — every later row would measure an " +
              "empty corpus. Results discarded.",
            );
          }

          const verdict = scoreRagAnswer(question, answer, citedTitles);
          const realWorld = realWorldAnswered(question, set, answer);
          const note = (question as { note?: string }).note;
          const noteRetrieved = note ? retrievedTitles.includes(note) : null;
          rows.push({ mode, question, answer, citedTitles, retrievedTitles, retrieval: retrievalTrace, toolCalls, verdict, realWorld, noteRetrieved, turnKind, turnNoted, ttft_ms, total_ms });
          console.log(`[rag-eval] ${mode.padEnd(6)} ${question.id.padEnd(4)} ${verdict.pass ? "PASS" : "FAIL"} — ${verdict.reason} · ttft ${ttft_ms ?? "-"}ms · total ${total_ms}ms`);
        }
      }
    }
  } finally {
    await deleteCourse(RAG_COURSE_ID).catch(() => {});
    inFlight = false;
  }

  const byMode: RagReport["byMode"] = {};
  const realWorld: RagReport["realWorld"] = {};
  const noteRetrieved: RagReport["noteRetrieved"] = {};
  for (const mode of modes) {
    const mine = rows.filter((r) => r.mode === mode);
    byMode[mode] = summarizeRag(mine.map((r) => ({ q: r.question, verdict: r.verdict })));
    const rw = mine.filter((r) => r.realWorld !== null);
    realWorld[mode] = { answered: rw.filter((r) => r.realWorld).length, total: rw.length };
    noteRetrieved[mode] = {};
    for (const r of mine.filter((r) => r.noteRetrieved !== null)) {
      const b = (noteRetrieved[mode][r.question.kind] ??= { retrieved: 0, total: 0 });
      b.total++;
      if (r.noteRetrieved) b.retrieved++;
    }
  }

  // The pre-committed bar, evaluated against the SHIPPING mechanism only.
  const shipping = byMode["always"] ?? {};
  const pos = shipping.positive ?? { pass: 0, total: 0 };
  const neg = shipping.negative ?? { pass: 0, total: 0 };
  const positivesPct = pos.total ? (pos.pass / pos.total) * 100 : 0;
  const negativesClean = neg.total > 0 && neg.pass === neg.total;
  const verdict = { positivesPct, negativesClean, meetsBar: positivesPct >= 80 && negativesClean };

  console.log("\n[rag-eval] ── summary ─────────────────────────────");
  for (const [mode, kinds] of Object.entries(byMode)) {
    const parts = Object.entries(kinds).map(([k, v]) => `${k} ${v.pass}/${v.total}`);
    console.log(`[rag-eval] ${mode.padEnd(6)} ${parts.join(" · ")}`);
    if (realWorld[mode].total) console.log(`[rag-eval] ${mode.padEnd(6)} real-world answered ${realWorld[mode].answered}/${realWorld[mode].total}`);
    const nr = Object.entries(noteRetrieved[mode]).map(([k, v]) => `${k} ${v.retrieved}/${v.total}`);
    if (nr.length) console.log(`[rag-eval] ${mode.padEnd(6)} note retrieved: ${nr.join(" · ")}`);
  }
  console.log(`[rag-eval] positives ${positivesPct.toFixed(0)}% (bar: 80%) · negatives ${negativesClean ? "CLEAN" : "FABRICATED A CITATION"} (bar: zero)`);
  console.log(`[rag-eval] ${verdict.meetsBar ? "MEETS THE BAR" : "DOES NOT MEET THE BAR — retrieval:always should not ship as the default"}`);

  return { model: config.model, provider: config.provider, contextTokens, repeats, turnNotes, set, rows, byMode, realWorld, noteRetrieved, verdict };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runRagEval = runRagEval;
}
