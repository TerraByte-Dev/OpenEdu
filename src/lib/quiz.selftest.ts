// Dev-only self-test for the quiz question validator (issue #26). Pure — no model calls — so it
// runs instantly in DevTools via window.__testQuizValidate(). Mirrors __testDsl / __testMathRender.
// Fixtures are derived from the screenshots that motivated the fix:
//   - a true_false with a "Which of the following…" stem (improper question type) → must be rejected
//   - a multiple_choice whose correct_answer isn't among its options → must be rejected
// plus well-formed questions that must be accepted.

import { validateQuizBatch, type GeneratedQuestion } from "./quiz";

interface Check { name: string; ok: boolean; detail?: string }

const allowed = new Set(["1.1", "1.2"]);

const base: GeneratedQuestion = {
  question_text: "",
  question_type: "multiple_choice",
  options: [],
  correct_answer: "",
  difficulty_level: 1,
  explanation: "An educational explanation.",
  subtopic_id: "1.1",
  blank_position: "",
  matching_pairs: [],
};

function check(name: string, qs: GeneratedQuestion[], expectIssues: boolean): Check {
  const issues = validateQuizBatch(qs, allowed);
  const ok = expectIssues ? issues.length > 0 : issues.length === 0;
  const detail = ok
    ? undefined
    : expectIssues
    ? "expected issues, got none"
    : `unexpected issues: ${issues.join(" | ")}`;
  return { name, ok, detail };
}

export function runQuizValidateSelfTest(): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [
    check("rejects true_false with a 'which of the following' stem", [{
      ...base,
      question_type: "true_false",
      question_text: "Which of the following correctly identifies the SI base unit for temperature?",
      correct_answer: "False",
    }], true),
    check("rejects multiple_choice whose correct_answer is not an option", [{
      ...base,
      question_text: "What is 10 L expressed in cubic meters?",
      options: ["A) 0.01 m³", "B) 50 m³", "C) 0.05 m³", "D) 100 m³"],
      correct_answer: "B) 500 m³",
    }], true),
    check("rejects multiple_choice with True/False options", [{
      ...base,
      question_text: "Water boils at 100 °C at sea level.",
      options: ["A) True", "B) False"],
      correct_answer: "A) True",
    }], true),
    check("accepts a well-formed multiple_choice", [{
      ...base,
      question_text: "Which SI base unit measures temperature?",
      options: ["A) kelvin", "B) meter", "C) second", "D) ampere"],
      correct_answer: "A) kelvin",
    }], false),
    check("accepts a declarative true_false", [{
      ...base,
      question_type: "true_false",
      question_text: "The SI base unit for temperature is the kelvin.",
      correct_answer: "True",
    }], false),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__testQuizValidate = () => {
    const r = runQuizValidateSelfTest();
    console.table(r.checks);
    console.log(r.ok ? "[quiz-validate] ✓ all checks passed" : "[quiz-validate] ✗ failures above");
    return r.ok;
  };
}
