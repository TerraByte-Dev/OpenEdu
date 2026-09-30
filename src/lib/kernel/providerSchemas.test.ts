import { describe, it, expect } from "vitest";
import { buildProviderToolDefs } from "./toolDispatch";
import { toolRegistry } from "../tools/registry";
import { registerBuiltinTools } from "../tools/builtins";

// Keywords small-model providers reject or ignore in a tool's parameters. Same list as
// src/lib/dsl/_roundTripCheck.ts:11, which doesn't export it.
const FORBIDDEN = ["$ref", "$defs", "definitions", "anyOf", "oneOf", "allOf", "$schema"];

// A file of its own: registerBuiltinTools sets a module-level flag, so it can't share a registry
// with tests that clear it.
describe("built-in tool provider defs", () => {
  registerBuiltinTools();
  const defs = buildProviderToolDefs(toolRegistry.all());

  it("registers all 11 built-in tools", () => {
    expect(defs).toHaveLength(11);
  });

  it.each(defs.map((d) => [d.name, d] as const))("%s has none of the forbidden keywords", (_name, def) => {
    const json = JSON.stringify(def.parameters);
    for (const key of FORBIDDEN) expect(json).not.toContain(`"${key}"`);
  });
});
