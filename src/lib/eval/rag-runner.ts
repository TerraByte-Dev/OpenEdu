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

import { tutorEngine, type TutorTurn } from "../kernel";
import type { RetrievalMode } from "../kernel/ground";
import { registerBuiltinTools, type ToolContext } from "../tools";
import { loadBuiltinSkills, resolveSkill } from "../skills";
import { buildSystemPrompt } from "../curriculum";
import { getChatConfig, getMaxContextTokens } from "../store";
import { detectModelProfile } from "../llm";
import { deleteCourse, ensureCourse } from "../db";
import { importTextAsNote } from "../notebook";
import { evalToolSyllabus } from "./goldens";
import { RAG_FIXTURE, RAG_QUESTIONS, scoreRagAnswer, summarizeRag, type RagQuestion, type RagVerdict } from "./rag-fixture";
import type { LLMConfig } from "../../types";

const RAG_COURSE_ID = "__eval_rag__";

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
  toolCalls: string[];
  verdict: RagVerdict;
}

export interface RagReport {
  model: string;
  provider: string;
  contextTokens: number;
  repeats: number;
  rows: RagRow[];
  /** mode → kind → { pass, total } */
  byMode: Record<string, Record<string, { pass: number; total: number }>>;
  /** Whether the pre-committed condition was met (see the console summary for the exact bars). */
  verdict: { positivesPct: number; negativesClean: boolean; meetsBar: boolean };
}

async function seedVault(): Promise<void> {
  await deleteCourse(RAG_COURSE_ID); // clear leftovers from a crashed run
  await ensureCourse(RAG_COURSE_ID, "Eval (RAG)", "Eval");
  for (const note of RAG_FIXTURE) {
    await importTextAsNote({ courseId: RAG_COURSE_ID, title: note.title, sourceType: "note", text: note.text });
  }
}

export async function runRagEval(opts?: { repeats?: number; modes?: RetrievalMode[]; only?: string }): Promise<RagReport> {
  const repeats = opts?.repeats ?? 1;
  const modes = opts?.modes ?? (["always", "off"] as RetrievalMode[]);
  const questions = opts?.only ? RAG_QUESTIONS.filter((q) => q.id === opts.only) : RAG_QUESTIONS;

  registerBuiltinTools();
  await loadBuiltinSkills();

  // Resolve the window exactly as ChatTab does, so the eval measures the configuration the app runs.
  const baseConfig = await getChatConfig();
  const profile = await detectModelProfile(baseConfig);
  const contextTokens = baseConfig.provider === "ollama"
    ? Math.min(profile.contextTokens, await getMaxContextTokens())
    : profile.contextTokens;
  const config: LLMConfig = { ...baseConfig, modelTier: profile.tier, contextTokens };

  console.log(`[rag-eval] ${config.provider}/${config.model} ctx=${contextTokens} · ${questions.length} question(s) × ${repeats} repeat(s) × ${modes.length} mode(s)`);

  const rows: RagRow[] = [];
  try {
    await seedVault();

    for (const mode of modes) {
      for (let rep = 0; rep < repeats; rep++) {
        for (const question of questions) {
          const skill = resolveSkill("explain") ?? null;
          const system = buildSystemPrompt(RAG_INSTRUCTIONS, evalToolSyllabus(), 1, "General Study", skill?.promptSuffix ?? "", undefined, undefined);
          const ctx: ToolContext = {
            courseId: RAG_COURSE_ID,
            level: 1,
            syllabus: evalToolSyllabus(),
            modelTier: profile.tier,
            contextTokens,
            permissionMode: "default",
            config,
            abort: new AbortController().signal,
            activeSkill: skill,
            confirmTool: async () => true,
          };
          const turn: TutorTurn = {
            messages: [
              ...(system.trim() ? [{ role: "system", content: system }] : []),
              { role: "user", content: question.ask },
            ],
            config,
            retrieval: mode,
            onText: () => {},
          };

          let answer = "";
          let citedTitles: string[] = [];
          let retrievedTitles: string[] = [];
          let toolCalls: string[] = [];
          try {
            const result = await tutorEngine.run(turn, ctx);
            answer = result.text;
            // The citation the STUDENT would see — n-gram verified, never the model's claim. In
            // tool-only mode the grounding stage does not run, so a cited title can still arrive via
            // the tool path only if the answer reused its text; that asymmetry is the thing measured.
            citedTitles = [...new Set(result.usedHits.map((h) => h.title))];
            retrievedTitles = result.grounding.trace.hitTitles;
            toolCalls = result.toolCalls.map((c) => c.name);
          } catch (e) {
            answer = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
          }

          const verdict = scoreRagAnswer(question, answer, citedTitles);
          rows.push({ mode, question, answer, citedTitles, retrievedTitles, toolCalls, verdict });
          console.log(`[rag-eval] ${mode.padEnd(6)} ${question.id.padEnd(4)} ${verdict.pass ? "PASS" : "FAIL"} — ${verdict.reason}`);
        }
      }
    }
  } finally {
    await deleteCourse(RAG_COURSE_ID).catch(() => {});
  }

  const byMode: RagReport["byMode"] = {};
  for (const mode of modes) {
    byMode[mode] = summarizeRag(rows.filter((r) => r.mode === mode).map((r) => ({ q: r.question, verdict: r.verdict })));
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
  }
  console.log(`[rag-eval] positives ${positivesPct.toFixed(0)}% (bar: 80%) · negatives ${negativesClean ? "CLEAN" : "FABRICATED A CITATION"} (bar: zero)`);
  console.log(`[rag-eval] ${verdict.meetsBar ? "MEETS THE BAR" : "DOES NOT MEET THE BAR — retrieval:always should not ship as the default"}`);

  return { model: config.model, provider: config.provider, contextTokens, repeats, rows, byMode, verdict };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runRagEval = runRagEval;
}
