import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { dispatchToolCall, selectTools, type ToolUIEvent } from "./toolDispatch";
import { toolRegistry } from "../tools/registry";
import { defineTool, type ToolContext } from "../tools/EduTool";
import { loadPermissionRules } from "../permissions/store";
import type { PermissionRules } from "../permissions/rules";
import type { Skill } from "../dsl/skill";
import type { LLMConfig } from "../../types";

// The real store imports @tauri-apps/plugin-store and caches rules at module level. Each test
// injects its own rule set instead.
vi.mock("../permissions/store", () => ({ loadPermissionRules: vi.fn() }));
const setRules = (rules: PermissionRules) => vi.mocked(loadPermissionRules).mockResolvedValue(rules);

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  courseId: "c1",
  level: 1,
  syllabus: null,
  modelTier: "tiny",
  config: { provider: "ollama", model: "test" } as LLMConfig,
  permissionMode: "default",
  abort: new AbortController().signal,
  ...over,
});

const skill = (name: string, tools: string[]): Skill => ({
  name,
  description: name,
  trigger: { course_subject: [] },
  tools_required: tools,
  model_tier_min: "tiny",
  domain_hints: [],
  body: "",
  promptSuffix: "",
});

const echoRan = vi.fn();
const echo = defineTool({
  name: "t.echo",
  description: "Echo the text back.",
  inputSchema: z.object({ text: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call(input) {
    echoRan();
    yield { kind: "progress", message: "echoing" };
    yield { kind: "result", value: { text: input.text } };
  },
});

const writer = defineTool({
  name: "t.write",
  description: "Write to the student's record.",
  inputSchema: z.object({}),
  isReadOnly: false,
  isConcurrencySafe: false,
  async *call() {
    yield { kind: "result", value: "written" };
  },
});

const progressOnly = defineTool({
  name: "t.progress_only",
  description: "Yields progress and nothing else.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call() {
    yield { kind: "progress", message: "working" };
  },
});

const yieldsError = defineTool({
  name: "t.yields_error",
  description: "Yields an error event.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  async *call() {
    yield { kind: "error", error: "nothing found" };
  },
});

const throws = defineTool({
  name: "t.throws",
  description: "Throws mid-call.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  // eslint-disable-next-line require-yield -- throws before its first yield
  async *call() {
    throw new Error("disk on fire");
  },
});

const validated = defineTool<z.ZodObject<{ empty: z.ZodBoolean }>, string | undefined>({
  name: "t.validated",
  description: "Output is checked by validateOutput.",
  inputSchema: z.object({ empty: z.boolean() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  validateOutput: () => ["duplicate answers"],
  async *call(input) {
    yield { kind: "result", value: input.empty ? undefined : "a, a" };
  },
});

const prose = defineTool({
  name: "t.prose",
  description: "Serializes its own model text.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  toModelText: (out: { hits: number }) => `${out.hits} hits`,
  async *call(): AsyncGenerator<{ kind: "result"; value: { hits: number } }> {
    yield { kind: "result", value: { hits: 3 } };
  },
});

const disabled = defineTool({
  name: "t.disabled",
  description: "Never enabled.",
  inputSchema: z.object({}),
  isReadOnly: true,
  isConcurrencySafe: true,
  isEnabled: () => false,
  async *call() {
    yield { kind: "result", value: "ran" };
  },
});

const ALL = [echo, writer, progressOnly, yieldsError, throws, validated, prose, disabled];

async function run(name: string, args: unknown, c: ToolContext = ctx(), offered?: ReadonlySet<string>) {
  const events: ToolUIEvent[] = [];
  const result = await dispatchToolCall({ id: "call-1", name, args }, c, (ev) => events.push(ev), offered);
  return { result, events };
}

const err = (name: string, error: string): ToolUIEvent => ({ kind: "error", id: "call-1", name, error });

beforeEach(() => {
  toolRegistry.clear();
  for (const t of ALL) toolRegistry.register(t);
  setRules({});
  echoRan.mockClear();
});

describe("dispatchToolCall", () => {
  it("refuses an unknown tool and lists every registered tool when nothing was offered", async () => {
    const { result, events } = await run("t.nope", {});
    const error = `Unknown tool "t.nope". Available tools: ${ALL.map((t) => t.name).join(", ")}.`;
    expect(result).toEqual({ name: "t.nope", ok: false, error });
    expect(events).toEqual([err("t.nope", error)]);
  });

  it("lists only the offered tools for an unknown name", async () => {
    const { result } = await run("t.nope", {}, ctx(), new Set(["t.echo", "t.prose"]));
    expect(result.error).toBe(`Unknown tool "t.nope". Available tools: t.echo, t.prose.`);
  });

  it("refuses a registered tool that wasn't offered, before validating args or running it", async () => {
    const { result, events } = await run("t.echo", { text: 42 }, ctx(), new Set(["t.prose"]));
    const error = `"t.echo" is not available this turn. Available: t.prose.`;
    expect(result).toEqual({ name: "t.echo", ok: false, error });
    expect(events).toEqual([err("t.echo", error)]);
    expect(echoRan).not.toHaveBeenCalled();
  });

  it("says (none) when the turn offered nothing", async () => {
    const { result } = await run("t.echo", { text: "hi" }, ctx(), new Set());
    expect(result.error).toBe(`"t.echo" is not available this turn. Available: (none).`);
    expect((await run("t.nope", {}, ctx(), new Set())).result.error).toBe(`Unknown tool "t.nope". Available tools: (none).`);
  });

  it("runs an offered tool", async () => {
    const { result, events } = await run("t.echo", { text: "hi" }, ctx(), new Set(["t.echo"]));
    expect(result).toEqual({ name: "t.echo", ok: true, value: { text: "hi" }, modelText: undefined });
    expect(events.map((e) => e.kind)).toEqual(["start", "progress", "result"]);
  });

  it("returns the zod issues in a fixed format", async () => {
    const { result, events } = await run("t.echo", { text: 42 });
    const error = "Invalid arguments for t.echo: text: Invalid input: expected string, received number. Call it again with arguments that match the schema.";
    expect(result).toEqual({ name: "t.echo", ok: false, error });
    expect(events).toEqual([err("t.echo", error)]);
    expect(echoRan).not.toHaveBeenCalled();
  });

  it("refuses a denied tool", async () => {
    setRules({ "t.echo": { default: "deny" } });
    const { result, events } = await run("t.echo", { text: "hi" });
    const error = "t.echo is not permitted in default mode.";
    expect(result).toEqual({ name: "t.echo", ok: false, error });
    expect(events).toEqual([err("t.echo", error)]);
    expect(echoRan).not.toHaveBeenCalled();
  });

  it("stops when the student declines an ask", async () => {
    const confirmTool = vi.fn(async () => false);
    const { result, events } = await run("t.write", {}, ctx({ confirmTool }));
    const error = "The student declined to let t.write run.";
    expect(result).toEqual({ name: "t.write", ok: false, error });
    expect(events).toEqual([err("t.write", error)]);
  });

  it("runs an approved ask and hands confirmTool the name and description", async () => {
    const confirmTool = vi.fn(async () => true);
    const { result, events } = await run("t.write", {}, ctx({ confirmTool }));
    expect(confirmTool).toHaveBeenCalledWith("t.write", "Write to the student's record.");
    expect(result).toEqual({ name: "t.write", ok: true, value: "written", modelText: undefined });
    expect(events).toEqual([
      { kind: "start", id: "call-1", name: "t.write" },
      { kind: "result", id: "call-1", name: "t.write", value: "written" },
    ]);
  });

  it("proceeds on an ask when there is no confirmTool (headless)", async () => {
    const { result } = await run("t.write", {});
    expect(result.ok).toBe(true);
  });

  it("never reports success for a generator that yielded no result (#86)", async () => {
    const { result, events } = await run("t.progress_only", {});
    const error = "t.progress_only finished without producing a result. Do not assume it succeeded — try a different approach or tell the student you could not complete that step.";
    expect(result).toEqual({ name: "t.progress_only", ok: false, error });
    expect(events).toEqual([
      { kind: "start", id: "call-1", name: "t.progress_only" },
      { kind: "progress", id: "call-1", name: "t.progress_only", message: "working" },
      err("t.progress_only", error),
    ]);
  });

  it("passes a yielded error through", async () => {
    const { result, events } = await run("t.yields_error", {});
    expect(result).toEqual({ name: "t.yields_error", ok: false, error: "nothing found" });
    expect(events).toEqual([{ kind: "start", id: "call-1", name: "t.yields_error" }, err("t.yields_error", "nothing found")]);
  });

  it("turns a thrown error into a failed result", async () => {
    const { result, events } = await run("t.throws", {});
    expect(result).toEqual({ name: "t.throws", ok: false, error: "disk on fire" });
    expect(events).toEqual([{ kind: "start", id: "call-1", name: "t.throws" }, err("t.throws", "disk on fire")]);
  });

  it("fails when validateOutput reports issues", async () => {
    const { result, events } = await run("t.validated", { empty: false });
    const error = "t.validated produced invalid output: duplicate answers.";
    expect(result).toEqual({ name: "t.validated", ok: false, error });
    expect(events).toEqual([{ kind: "start", id: "call-1", name: "t.validated" }, err("t.validated", error)]);
  });

  it("skips validateOutput when the result value is undefined", async () => {
    const { result, events } = await run("t.validated", { empty: true });
    expect(result).toEqual({ name: "t.validated", ok: true, value: undefined, modelText: undefined });
    expect(events.map((e) => e.kind)).toEqual(["start", "result"]);
  });

  it("uses toModelText for the model and keeps the full value for the UI", async () => {
    const { result } = await run("t.prose", {});
    expect(result).toEqual({ name: "t.prose", ok: true, value: { hits: 3 }, modelText: "3 hits" });
  });
});

describe("selectTools", () => {
  const names = async (c: ToolContext) => (await selectTools(c)).map((t) => t.name);

  it("offers only the mode skill's tools", async () => {
    expect(await names(ctx({ activeSkill: skill("explain", ["t.echo", "t.prose"]) }))).toEqual(["t.echo", "t.prose"]);
  });

  it("offers the union of the mode and domain skills", async () => {
    const c = ctx({ activeSkill: skill("explain", ["t.echo"]), domainSkill: skill("math-tutor", ["t.prose"]) });
    expect(await names(c)).toEqual(["t.echo", "t.prose"]);
  });

  it("offers every permitted, enabled tool when no skill is set", async () => {
    expect(await names(ctx())).toEqual(ALL.filter((t) => t !== disabled).map((t) => t.name));
  });

  it("drops a denied tool even when the skill asks for it", async () => {
    setRules({ "t.echo": { default: "deny" } });
    expect(await names(ctx({ activeSkill: skill("explain", ["t.echo", "t.prose"]) }))).toEqual(["t.prose"]);
  });

  it("drops a disabled tool even when the skill asks for it", async () => {
    expect(await names(ctx({ activeSkill: skill("explain", ["t.disabled", "t.prose"]) }))).toEqual(["t.prose"]);
  });
});
