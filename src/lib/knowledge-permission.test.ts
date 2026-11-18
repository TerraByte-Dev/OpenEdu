import { describe, it, expect, vi, beforeEach } from "vitest";

// The post-turn reflection (updateKnowledgeFiles, what ChatTab runs after every reply) obeys "Update
// knowledge map" in Settings › Tutor Permissions: Deny writes nothing and calls no model. Ask lets it run,
// as it cannot stop to ask after every reply (the Settings row says so); that is the default.
// Ported from TerraTutor #202.
vi.mock("./llm", () => ({
  callLLM: vi.fn(),
  callLLMStreaming: vi.fn(),
  callLLMStructured: vi.fn(),
  detectModelTier: vi.fn(async () => "tiny"),
  log: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("./db", () => ({
  getTutorInstructions: vi.fn(async () => ({})),
  saveTutorInstruction: vi.fn(async () => {}),
}));
vi.mock("./permissions/store", () => ({ loadPermissionRules: vi.fn() }));

import { updateKnowledgeFiles } from "./knowledge";
import { callLLM } from "./llm";
import { saveTutorInstruction } from "./db";
import { loadPermissionRules } from "./permissions/store";
import { DEFAULT_PERMISSION_RULES, type PermissionDecision } from "./permissions/rules";
import type { LLMConfig } from "../types";

const config = { provider: "ollama", model: "gemma4:e2b" } as unknown as LLMConfig;
const rule = (decision: PermissionDecision) =>
  vi.mocked(loadPermissionRules).mockResolvedValue({
    ...DEFAULT_PERMISSION_RULES,
    "knowledge.update_map": { ...DEFAULT_PERMISSION_RULES["knowledge.update_map"], default: decision },
  });

beforeEach(() => {
  vi.mocked(callLLM).mockReset();
  vi.mocked(callLLM).mockResolvedValue('{"knowledge_map": "Knows that 6 x 7 = 42."}');
  vi.mocked(saveTutorInstruction).mockClear();
});

describe("updateKnowledgeFiles and the Update knowledge map permission", () => {
  it("writes nothing and calls no model on Deny", async () => {
    rule("deny");
    await updateKnowledgeFiles("course-1", "Is 6 x 7 = 42?", "Yes, 6 x 7 = 42.", config);
    expect(callLLM).not.toHaveBeenCalled();
    expect(saveTutorInstruction).not.toHaveBeenCalled();
  });

  for (const decision of ["ask", "allow"] as const) {
    it(`runs on ${decision}`, async () => {
      rule(decision);
      await updateKnowledgeFiles("course-1", "Is 6 x 7 = 42?", "Yes, 6 x 7 = 42.", config);
      expect(saveTutorInstruction).toHaveBeenCalledWith("course-1", "knowledge_map", "Knows that 6 x 7 = 42.");
    });
  }

  it("runs under the default rules", async () => {
    vi.mocked(loadPermissionRules).mockResolvedValue({ ...DEFAULT_PERMISSION_RULES });
    await updateKnowledgeFiles("course-1", "Is 6 x 7 = 42?", "Yes, 6 x 7 = 42.", config);
    expect(callLLM).toHaveBeenCalledTimes(1);
  });
});
