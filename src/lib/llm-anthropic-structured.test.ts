import { describe, it, expect, afterEach, vi } from "vitest";

// Anthropic structured calls ask for structured outputs (output_config.format), not a forced tool.
// Sonnet 5.5, Opus 5.5 and Fable 5.2 answer a forced tool_choice with a 400, and all four current models
// accept output_config.format (TerraTutor B10 round 2's probe, 2026-11-14). The API rejects some JSON
// Schema keywords there (minLength, maxLength, maxItems, minimum…), so the schema on the wire drops them
// and the local validator, the over-long trim and the repair prompt still hold the reply to the full
// schema. These tests run callLLMStructured against a fake Anthropic endpoint; nothing touches the network.
vi.mock("@tauri-apps/plugin-http", () => import("./eval/headless/shims/plugin-http"));

import { callLLMStructured, anthropicOutputSchema } from "./llm";
import type { LLMConfig } from "../types";

const SONNET = { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "test-key", modelTier: "large" } as LLMConfig;
const USER = [{ role: "system", content: "You write course text." }, { role: "user", content: "go" }];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "points", "level"],
  properties: {
    title: { type: "string", minLength: 5, maxLength: 40, description: "A short title" },
    points: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 10 } },
    level: { type: "integer", minimum: 1, maximum: 6 },
    // A property whose NAME is a keyword the API rejects must survive as a property.
    format: { type: "object", properties: { minimum: { type: "string", enum: ["a", "b"] } }, required: ["minimum"] },
  },
};

type Sent = { body: Record<string, unknown> };
let sent: Sent[] = [];
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; sent = []; });

function fake(answer: (body: Record<string, unknown>, n: number) => Response) {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({ body });
    return answer(body, sent.length);
  }) as unknown as typeof fetch;
}
const text = (value: unknown, stop = "end_turn") =>
  Response.json({ stop_reason: stop, content: [{ type: "thinking", thinking: "…" }, { type: "text", text: JSON.stringify(value) }] });
const GOOD = { title: "Fractions", points: ["Halves are two equal parts.", "Thirds are three equal parts.", "More parts, smaller parts."], level: 2, format: { minimum: "a" } };

describe("anthropicOutputSchema: the schema as the structured-outputs API accepts it", () => {
  const wire = anthropicOutputSchema(SCHEMA) as Record<string, any>;

  it("drops the keywords the API rejects and says them in the description instead", () => {
    expect(wire.properties.title).toEqual({ type: "string", description: "A short title (at least 5 characters; at most 40 characters)" });
    expect(wire.properties.points.minItems).toBeUndefined();
    expect(wire.properties.points.maxItems).toBeUndefined();
    expect(wire.properties.points.description).toBe("at least 3 items; at most 5 items");
    expect(wire.properties.points.items).toEqual({ type: "string", description: "at least 10 characters" });
    expect(wire.properties.level).toEqual({ type: "integer", description: "at least 1; at most 6" });
  });

  it("keeps a property named like a keyword, enum, required and minItems 0 or 1", () => {
    expect(wire.properties.format.properties.minimum).toEqual({ type: "string", enum: ["a", "b"] });
    expect(wire.required).toEqual(["title", "points", "level"]);
    expect((anthropicOutputSchema({ type: "array", minItems: 1, items: { type: "string" } }) as Record<string, unknown>).minItems).toBe(1);
  });

  it("sets additionalProperties false on every object, as the API requires", () => {
    expect(wire.additionalProperties).toBe(false);
    expect(wire.properties.format.additionalProperties).toBe(false);
  });

  it("does not change the schema it was given (the local validator still uses the full one)", () => {
    expect(SCHEMA.properties.title.maxLength).toBe(40);
    expect((SCHEMA.properties.format as Record<string, unknown>).additionalProperties).toBeUndefined();
  });
});

describe("callLLMStructured on Anthropic", () => {
  it("sends output_config.format with the API's schema, and no forced tool", async () => {
    fake(() => text(GOOD));
    const out = await callLLMStructured(USER, { ...SONNET }, { schema: SCHEMA, toolName: "emit_x" });
    expect(out).toEqual(GOOD);
    expect(sent).toHaveLength(1);
    const body = sent[0].body;
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema: anthropicOutputSchema(SCHEMA) } });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.system).toBe("You write course text.");
    expect(body.messages).toEqual([{ role: "user", content: "go" }]);
  });

  it("still validates locally against the full schema: too few items go to the repair prompt", async () => {
    fake((_b, n) => text(n === 1 ? { ...GOOD, points: ["Only one point here."] } : GOOD));
    const out = await callLLMStructured(USER, { ...SONNET }, { schema: SCHEMA });
    expect(out).toEqual(GOOD);
    expect(sent).toHaveLength(2);
    const msgs = sent[1].body.messages as Array<{ role: string; content: string }>;
    expect(msgs[msgs.length - 1].content).toContain("$.points: expected ≥3 items, got 1");
    // The repair turn ends on the user, never an assistant prefill (structured outputs reject prefill).
    expect(msgs[msgs.length - 1].role).toBe("user");
  });

  it("still trims a field that only runs past its maxLength, with no second call", async () => {
    fake(() => text({ ...GOOD, title: "Fractions for beginners. A long subtitle that runs on." }));
    const out = await callLLMStructured<typeof GOOD>(USER, { ...SONNET }, { schema: SCHEMA });
    expect(out.title).toBe("Fractions for beginners.");
    expect(sent).toHaveLength(1);
  });

  it("treats a refusal or a cut-off reply as no valid JSON and repairs", async () => {
    fake((_b, n) => (n === 1
      ? Response.json({ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"title\": \"Fract" }] })
      : text(GOOD)));
    expect(await callLLMStructured(USER, { ...SONNET }, { schema: SCHEMA })).toEqual(GOOD);
    expect(sent).toHaveLength(2);
  });
});

describe("fallback when a model rejects structured outputs", () => {
  const rejectFormat = () => Response.json(
    { type: "error", error: { type: "invalid_request_error", message: "output_config.format: structured outputs are not supported for this model" } },
    { status: 400 },
  );

  it("retries the same call with the forced tool and returns its input", async () => {
    fake((body) => (body.output_config ? rejectFormat() : Response.json({ content: [{ type: "tool_use", name: "emit_x", input: GOOD }] })));
    const out = await callLLMStructured(USER, { ...SONNET, model: "claude-legacy-model" }, { schema: SCHEMA, toolName: "emit_x" });
    expect(out).toEqual(GOOD);
    expect(sent).toHaveLength(2);
    expect(sent[1].body).not.toHaveProperty("output_config");
    expect(sent[1].body.tool_choice).toEqual({ type: "tool", name: "emit_x" });
    expect((sent[1].body.tools as Array<{ input_schema: unknown }>)[0].input_schema).toEqual(SCHEMA);
  });

  it("does not fall back on a 400 that is not about the output format", async () => {
    fake(() => Response.json({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: too large" } }, { status: 400 }));
    await expect(callLLMStructured(USER, { ...SONNET }, { schema: SCHEMA, maxRepairAttempts: 0 })).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });
});
