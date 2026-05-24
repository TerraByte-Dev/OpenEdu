// Eval runner — drives each golden through the CURRENT v1 chat path to capture a baseline.
//
// It mirrors ChatTab.sendMessage's assembly (buildSystemPrompt + accumulated history +
// callLLMStreaming), so the numbers reflect real v1 prompting. When TutorEngine owns assembly
// in Phase 1, this runner swaps to TutorEngine.run() — same goldens, apples-to-apples.
//
// Runs in the Tauri webview (uses the app's LLM path) → needs Ollama up + a model configured.
//     await window.__runEvals()                 // all goldens
//     await window.__runEvals({ only: "math-word-problem" })

import { callLLMStreaming, detectModelTier } from "../llm";
import { buildSystemPrompt } from "../curriculum";
import { getChatConfig } from "../store";
import { getTutorModePrompt } from "../tutor-modes";
import { tutorEngine, type TutorTurn } from "../kernel";
import { registerBuiltinTools, type ToolContext } from "../tools";
import { loadBuiltinSkills, resolveSkill } from "../skills";
import { GOLDENS, type Golden, type GoldenTranscriptEntry } from "./goldens";

// Eval-only stand-in for a generated course's tutor instructions. The math rule is inlined
// (mirrors src/lib/formatting.ts) so the harness stays self-contained and doesn't couple to a
// production prompt constant — the math golden still gets tested against a plain-text-math guard.
const EVAL_MATH_RULE = "Write all mathematics in plain text (×, ÷, ², √, π, ≤, ≥). Do not use LaTeX, backslash commands, or $…$ delimiters.";
const EVAL_INSTRUCTIONS: Record<string, string> = {
  identity: "You are a patient, encouraging tutor. Explain clearly and concisely.",
  rules: EVAL_MATH_RULE,
};

interface GoldenRun {
  id: string;
  title: string;
  pass: boolean;
  reasons: string[];
  transcript: GoldenTranscriptEntry[];
}

async function runGolden(g: Golden, config: Awaited<ReturnType<typeof getChatConfig>>): Promise<GoldenRun> {
  if (g.useTools) return runGoldenWithTools(g, config);

  const transcript: GoldenTranscriptEntry[] = [];
  const history: Array<{ role: string; content: string }> = [];

  for (const turn of g.turns) {
    const system = buildSystemPrompt(EVAL_INSTRUCTIONS, null, 1, g.topic, getTutorModePrompt(turn.mode ?? "explain"), undefined);
    const messages = [
      ...(system.trim() ? [{ role: "system", content: system }] : []),
      ...history,
      { role: "user", content: turn.user },
    ];
    let out = "";
    await callLLMStreaming(messages, config, (tok) => { out += tok; });

    history.push({ role: "user", content: turn.user });
    history.push({ role: "assistant", content: out });
    transcript.push({ role: "user", content: turn.user, mode: turn.mode });
    transcript.push({ role: "assistant", content: out, mode: turn.mode });
  }

  const res = g.success(transcript);
  return { id: g.id, title: g.title, pass: res.pass, reasons: res.reasons, transcript };
}

// Tool goldens run through the REAL kernel (TutorEngine + registered tools) so we exercise the
// full Phase 1 path and capture tool_calls. The 5 baseline goldens stay on the v1 path above,
// byte-identical. Tool DB writes target the seeded syllabus's sentinel course (harmless no-ops).
async function runGoldenWithTools(g: Golden, config: Awaited<ReturnType<typeof getChatConfig>>): Promise<GoldenRun> {
  registerBuiltinTools();
  loadBuiltinSkills();
  const transcript: GoldenTranscriptEntry[] = [];
  const history: Array<{ role: string; content: string }> = [];
  const modelTier = await detectModelTier(config);

  for (const turn of g.turns) {
    const system = buildSystemPrompt(EVAL_INSTRUCTIONS, g.syllabus ?? null, 1, g.topic, getTutorModePrompt(turn.mode ?? "explain"), undefined);
    const messages = [
      ...(system.trim() ? [{ role: "system", content: system }] : []),
      ...history,
      { role: "user", content: turn.user },
    ];

    const ctx: ToolContext = {
      courseId: g.syllabus?.course_id ?? "__eval__",
      level: g.syllabus?.level ?? 1,
      syllabus: g.syllabus ?? null,
      modelTier,
      permissionMode: "default",
      config,
      abort: new AbortController().signal,
      // The active skill gates which tools are offered this turn (Phase 2) — assess exposes
      // progress.mark_mastered; explain exposes none.
      activeSkill: resolveSkill(turn.mode ?? "explain") ?? null,
      // No askUser in the headless eval — ask_user.question would return an error the model recovers
      // from. confirmTool auto-approves so a "default"-mode write (which is "ask") still runs end-to-end.
      confirmTool: async () => true,
    };
    const tt: TutorTurn = { messages, config, onText: () => {} };
    const result = await tutorEngine.run(tt, ctx);

    history.push({ role: "user", content: turn.user });
    history.push({ role: "assistant", content: result.text });
    transcript.push({ role: "user", content: turn.user, mode: turn.mode });
    transcript.push({
      role: "assistant",
      content: result.text,
      mode: turn.mode,
      toolCalls: result.toolCalls.map((tc) => ({ name: tc.name, input: tc.args })),
    });
  }

  const res = g.success(transcript);
  return { id: g.id, title: g.title, pass: res.pass, reasons: res.reasons, transcript };
}

export interface EvalReport {
  model: string;
  passed: number;
  total: number;
  rows: Array<{ id: string; pass: boolean; reasons: string }>;
  runs: GoldenRun[];
}

export async function runEvals(opts?: { only?: string }): Promise<EvalReport> {
  const config = await getChatConfig();
  const goldens = opts?.only ? GOLDENS.filter((g) => g.id === opts.only) : GOLDENS;
  console.log(`[eval] model=${config.provider}/${config.model} — running ${goldens.length} golden(s)`);

  const runs: GoldenRun[] = [];
  for (const g of goldens) {
    console.log(`[eval] → ${g.id}…`);
    try {
      const r = await runGolden(g, config);
      console.log(`[eval] ${r.pass ? "✓" : "✗"} ${g.id}${r.reasons.length ? " — " + r.reasons.join("; ") : ""}`);
      runs.push(r);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[eval] ✗ ${g.id} threw: ${reason}`);
      runs.push({ id: g.id, title: g.title, pass: false, reasons: [`threw: ${reason}`], transcript: [] });
    }
  }

  const rows = runs.map((r) => ({ id: r.id, pass: r.pass, reasons: r.reasons.join("; ") }));
  const passed = runs.filter((r) => r.pass).length;
  console.table(rows);
  console.log(`[eval] BASELINE: ${passed}/${runs.length} passed (model=${config.model}). Transcripts on the returned report.runs[].transcript`);
  return { model: config.model, passed, total: runs.length, rows, runs };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__runEvals = runEvals;
}
