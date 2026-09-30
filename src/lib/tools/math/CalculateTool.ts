// math.calculate — evaluate an arithmetic expression deterministically (#130). The model does no
// arithmetic of its own: it passes the expression, gets the number back, and phrases over it. The
// evaluator (src/lib/calc.ts) is pure and whitelisted; an invalid expression comes back as an error
// the model can correct and retry on its next iteration.

import { z } from "zod";
import { defineTool, type ToolEvent } from "../EduTool";
import { calculate } from "../../calc";

export interface CalculateResult {
  expression: string;
  value: number;
  display: string;
}

export const mathCalculateTool = defineTool({
  name: "math.calculate",
  description:
    "Calculate an arithmetic expression exactly. CALL THIS for every number you compute — never do " +
    "arithmetic in your head. Supports + - * / ^, parentheses, pi, e, and sqrt abs sin cos tan " +
    "(radians) ln log10 round. Example: 150 / 2.5",
  inputSchema: z.object({
    expression: z.string().min(1).describe("The arithmetic to evaluate, e.g. 12 * 5 / 1.5 or sqrt(3^2 + 4^2)."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  toModelText: (out: CalculateResult) => `${out.expression} = ${out.display}`,
  async *call(input): AsyncGenerator<ToolEvent<CalculateResult>> {
    const r = calculate(input.expression);
    if (!r.ok) {
      yield { kind: "error", error: `Could not calculate "${input.expression}": ${r.error}. Fix the expression and call again.` };
      return;
    }
    yield { kind: "result", value: { expression: r.normalized, value: r.value, display: r.display } };
  },
});
