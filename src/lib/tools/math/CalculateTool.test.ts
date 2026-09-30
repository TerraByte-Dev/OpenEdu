import { describe, it, expect } from "vitest";
import type { ToolContext } from "../EduTool";
import { mathCalculateTool } from "./CalculateTool";
import { registerBuiltinTools } from "../builtins";
import { toolRegistry } from "../registry";
import { resolveDomainSkill } from "../../skills";

const run = async (expression: string) => {
  const events = [];
  for await (const ev of mathCalculateTool.call({ expression }, {} as ToolContext)) events.push(ev);
  return events;
};

describe("math.calculate", () => {
  it("yields the result and gives the model the number", async () => {
    const events = await run("150 / 2.5");
    expect(events).toEqual([{ kind: "result", value: { expression: "150/2.5", value: 60, display: "60" } }]);
    if (events[0].kind === "result") expect(mathCalculateTool.toModelText?.(events[0].value)).toBe("150/2.5 = 60");
  });

  it("yields an error the model can retry from, not a result", async () => {
    const events = await run("1/0");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error", error: expect.stringMatching(/division by zero/) });
  });

  // AC3 gating: offered by math-tutor, and actually registered so the kernel can run it.
  it("is offered by math-tutor and registered", () => {
    expect(resolveDomainSkill("Algebra", "tiny")?.tools_required).toContain("math.calculate");
    registerBuiltinTools();
    expect(toolRegistry.get("math.calculate")).toBeDefined();
  });
});
