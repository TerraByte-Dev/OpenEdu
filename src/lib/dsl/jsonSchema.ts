// zod → provider-ready JSON Schema.
//
// All three providers (Ollama `format`, OpenAI `json_schema`, Anthropic `input_schema`) and
// the existing validateAgainstSchema (llm.ts) consume raw JSON Schema. zod v4's z.toJSONSchema()
// emits clean, inline JSON Schema for our shapes — empirically no $ref/$defs/anyOf (verified
// against nested objects, arrays w/ min·max, enum, regex, int bounds). The only thing to strip
// is the top-level `$schema` URL key, which some constrained-sampling backends dislike. This is
// the single conversion seam every tool/DSL schema passes through before hitting a provider.

import { z } from "zod";

function stripSchemaKeyword(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSchemaKeyword);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      out[k] = stripSchemaKeyword(v);
    }
    return out;
  }
  return node;
}

export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return stripSchemaKeyword(z.toJSONSchema(schema)) as Record<string, unknown>;
}
