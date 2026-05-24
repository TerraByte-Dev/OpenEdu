// Dev-only spike: does native tool-calling hold up when STREAMED on the floor model?
//
// V2_DECISION_TOOLCALL.md measured 0.98 arg-compliance for native tools — but NON-streaming.
// Phase 1 ships unified streaming-with-tools (callLLMTurn streams text + tool calls from one
// generator), so we must confirm the floor model (gemma4:e4b) still emits well-formed tool
// arguments while streaming. This exercises the REAL callLLMTurn path (not a direct fetch), so a
// pass validates what we ship. If compliance craters here, the Ollama adapter can fall back to a
// non-streaming request internally without changing the kernel.
//
// Run in `tauri dev` DevTools:  await window.__spikeToolStreaming()           // gemma4:e4b, n=5
//                               await window.__spikeToolStreaming("gemma3:4b", "http://127.0.0.1:11434", 8)
//
// Record the printed aggregate in V2_DECISION_TOOLCALL.md.

import { z } from "zod";
import { callLLMTurn, type ProviderToolDef } from "../llm";
import { toProviderJsonSchema } from "../dsl/jsonSchema";
import type { LLMConfig } from "../../types";

interface Shape {
  name: string;
  description: string;
  schema: z.ZodType;
  prompt: string;
}

// The same five shapes the original spike used: no-arg read, single-string search, multi-field
// int-bounded write, enum pick, nested-object update.
const SHAPES: Shape[] = [
  {
    name: "progress_read",
    description: "Read the student's current progress. Takes no arguments.",
    schema: z.object({}),
    prompt: "Check how the student is doing. Call progress_read.",
  },
  {
    name: "notebook_search",
    description: "Search the student's notebook for a query string.",
    schema: z.object({ query: z.string().min(1) }),
    prompt: "Find what the notebook says about derivatives. Call notebook_search.",
  },
  {
    name: "study_plan_create",
    description: "Create a study plan for the student.",
    schema: z.object({ goal: z.string().min(1), due: z.string().min(1), level: z.number().int().min(1).max(5) }),
    prompt: "Make a study plan: goal 'master derivatives', due 'Friday', for level 2. Call study_plan_create.",
  },
  {
    name: "progress_mark",
    description: "Mark a subtopic's status.",
    schema: z.object({ subtopic_id: z.string().min(1), status: z.enum(["mastered", "practiced", "struggling"]) }),
    prompt: "The student mastered subtopic '2.3'. Call progress_mark.",
  },
  {
    name: "knowledge_update_map",
    description: "Add or update a concept node in the knowledge map.",
    schema: z.object({
      node: z.object({ id: z.string().min(1), label: z.string().min(1), relates_to: z.array(z.string()).min(1) }),
    }),
    prompt: "Add a knowledge node: id 'n7', label 'Chain Rule', relates_to ['n2','n5']. Call knowledge_update_map.",
  },
];

async function runShape(config: LLMConfig, shape: Shape, n: number): Promise<{ shape: string; emit: number; compliance: number; avgMs: number }> {
  const toolDef: ProviderToolDef = { name: shape.name, description: shape.description, parameters: toProviderJsonSchema(shape.schema) };
  let emits = 0;
  let compliant = 0;
  let totalMs = 0;

  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    let called = false;
    let args: unknown;
    try {
      for await (const ev of callLLMTurn([{ role: "user", content: shape.prompt }], config, { tools: [toolDef], tier: "small", temperature: 0 })) {
        if (ev.type === "tool_call" && !called) { called = true; args = ev.args; }
      }
    } catch (e) {
      console.warn(`[spike] ${shape.name} run ${i + 1} threw`, e);
    }
    totalMs += performance.now() - t0;
    if (called) {
      emits++;
      if (shape.schema.safeParse(args).success) compliant++;
    }
  }
  return { shape: shape.name, emit: +(emits / n).toFixed(2), compliance: +(compliant / n).toFixed(2), avgMs: Math.round(totalMs / n) };
}

export async function spikeToolStreaming(model = "gemma4:e4b", ollamaUrl = "http://127.0.0.1:11434", n = 5) {
  const config: LLMConfig = { provider: "ollama", model, ollamaUrl };
  console.log(`[spike] streaming+tools on ${model} (n=${n} per shape)…`);
  const rows = [];
  for (const shape of SHAPES) rows.push(await runShape(config, shape, n));
  console.table(rows);
  const emit = +(rows.reduce((s, r) => s + r.emit, 0) / rows.length).toFixed(2);
  const compliance = +(rows.reduce((s, r) => s + r.compliance, 0) / rows.length).toFixed(2);
  console.log(`[spike] AGGREGATE streamed: emit ${emit} / compliance ${compliance} (non-streaming baseline was 0.98). Record in V2_DECISION_TOOLCALL.md.`);
  return { model, n, rows, emit, compliance };
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__spikeToolStreaming = spikeToolStreaming;
}
