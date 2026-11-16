import { it } from "vitest";
import { installAppOrigin } from "./origin";
import { env, writeText } from "./node-io";
import { gradeAnswersBatch, type AnswerToGrade } from "../../quiz";
import { GRADE_DEV_MISSPELLINGS, GRADE_DEV_NAMES_TIMES, GRADE_DEV_DIRECTION_YEARS, GRADE_DEV_NUMBERS, GRADE_DEV_RESTATE, GRADE_DEV_SIGNS_LETTERS, GRADE_DEV_SYNONYMS, round2AsQuestions } from "../grade-dev";
import type { LLMConfig } from "../../../types";

// Written-answer grading on a dev set, through the app's path: code first (settleByCode), then the model
// (gradeAnswersBatch), in batches of 10 in a fixed shuffled order. Runs only when EVAL_GRADE_SET is set,
// so a plain `npm run eval` never starts it:
//   EVAL_GRADE_SET=synonyms|round2|signs|misspell|numbers|names-times|restate|direction-years  EVAL_MODEL (gemma4:e2b)  EVAL_REPEATS (1)  EVAL_OUT (results JSON)
//   npx vitest run -c vitest.eval.config.ts src/lib/eval/headless/grade-dev.eval.ts

function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const setName = env().EVAL_GRADE_SET;

it.skipIf(!setName)("grades a written-answer dev set", async () => {
  installAppOrigin();
  const set = setName === "round2" ? round2AsQuestions() : setName === "synonyms" ? GRADE_DEV_SYNONYMS : setName === "signs" ? GRADE_DEV_SIGNS_LETTERS : setName === "misspell" ? GRADE_DEV_MISSPELLINGS : setName === "numbers" ? GRADE_DEV_NUMBERS : setName === "names-times" ? GRADE_DEV_NAMES_TIMES : setName === "restate" ? GRADE_DEV_RESTATE : setName === "direction-years" ? GRADE_DEV_DIRECTION_YEARS : null;
  if (!set) throw new Error(`EVAL_GRADE_SET must be synonyms, round2, signs, misspell, numbers, names-times, restate or direction-years, not ${setName}`);
  const model = env().EVAL_MODEL ?? "gemma4:e2b";
  const runs = Number(env().EVAL_REPEATS ?? 1);
  const items = set.flatMap((q) => q.answers.map((a, k) => ({ id: `${q.id}.${k}`, question: q.question, expected: q.key, student: a.text, label: a.right, kind: a.kind })));
  const order = shuffled(items, 7);
  const rows: Array<{ run: number; id: string; kind: string; label: boolean; by: string; correct: boolean | null; student: string; feedback: string }> = [];
  for (let run = 1; run <= runs; run++) {
    for (let start = 0; start < order.length; start += 10) {
      const batch = order.slice(start, start + 10);
      const req: AnswerToGrade[] = batch.map((b, k) => ({ index: k, question: b.question, expected: b.expected, student: b.student, type: "short_answer" }));
      const config = { provider: "ollama", model, ollamaUrl: "http://127.0.0.1:11434", contextTokens: 8192 } as LLMConfig;
      const out = await gradeAnswersBatch(req, config);
      for (const [k, b] of batch.entries()) {
        const o = out.get(k);
        rows.push({ run, id: b.id, kind: b.kind, label: b.label, by: o?.by ?? "missing", correct: o?.isCorrect ?? null, student: b.student, feedback: o?.feedback ?? "" });
      }
    }
    const mine = rows.filter((r) => r.run === run);
    const rightFailed = mine.filter((r) => r.label && r.correct !== true);
    const wrongPassed = mine.filter((r) => !r.label && r.correct === true);
    const nRight = mine.filter((r) => r.label).length;
    console.log(`[grade] ${model} ${setName} run ${run}: right failed ${rightFailed.length}/${nRight}, wrong passed ${wrongPassed.length}/${mine.length - nRight}, by code ${mine.filter((r) => r.by === "exact").length} (marked wrong ${mine.filter((r) => r.by === "exact" && r.correct === false).length}), fallback ${mine.filter((r) => r.by === "fallback").length}`);
    console.log(`[grade]   right failed: ${rightFailed.map((r) => `${r.id} ${r.kind} "${r.student}"`).join("; ")}`);
    console.log(`[grade]   wrong passed: ${wrongPassed.map((r) => `${r.id} ${r.kind} "${r.student}"`).join("; ")}`);
  }
  const out = env().EVAL_OUT ?? `grade-dev-${setName}-${model.replace(/[:/]/g, "_")}.json`;
  await writeText(out, JSON.stringify({ model, set: setName, runs, rows }, null, 1));
  console.log(`[grade] wrote ${out}`);
});
