import { describe, it, expect, vi, beforeEach } from "vitest";

// A Map-backed plugin-store so the real store.ts / settings-io.ts read and write paths run in node.
const saved = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: async () => ({
      get: async (k: string) => saved.get(k),
      set: async (k: string, v: unknown) => { saved.set(k, v); },
      delete: async (k: string) => saved.delete(k),
      entries: async () => [...saved.entries()],
      save: async () => {},
    }),
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("./llm", () => ({ getOllamaModels: vi.fn() }));
vi.mock("./permissions", () => ({ loadPermissionRules: async () => ({}), savePermissionRules: async () => {} }));

import { getTourSeen, setTourSeen, clearLearnerStore, getDailyGoal, setDailyGoal, getActiveMinutes, setActiveMinutes } from "./store";
import { gatherSettings } from "./settings-io";
import { STORE_KEYS, LEARNER_SCOPED_KEYS, learnerStoreKey, isLearnerScopedKey, apiKeyStoreKey } from "./store-keys";
import { DEFAULT_LEARNER_ID } from "./learners";

describe("per-learner store keys", () => {
  beforeEach(() => saved.clear());

  it("the default learner keeps the bare key, so an upgraded install reads what it wrote before", async () => {
    expect(learnerStoreKey(STORE_KEYS.tourSeen, DEFAULT_LEARNER_ID)).toBe(STORE_KEYS.tourSeen);
    saved.set(STORE_KEYS.tourSeen, true); // written by a pre-profiles build
    expect(await getTourSeen(DEFAULT_LEARNER_ID)).toBe(true);
  });

  it("each other learner gets its own key, distinct from everyone else's", () => {
    const a = learnerStoreKey(STORE_KEYS.tourSeen, "a");
    const b = learnerStoreKey(STORE_KEYS.tourSeen, "b");
    expect(new Set([STORE_KEYS.tourSeen, a, b]).size).toBe(3);
    expect(isLearnerScopedKey(a)).toBe(true);
    expect(isLearnerScopedKey(STORE_KEYS.tourSeen)).toBe(false);
  });

  it("one learner finishing the tour does not hide it from another", async () => {
    await setTourSeen(DEFAULT_LEARNER_ID, true);
    expect(await getTourSeen("new-learner")).toBe(false);
    await setTourSeen("new-learner", true);
    expect(await getTourSeen("new-learner")).toBe(true);
    expect(await getTourSeen("someone-else")).toBe(false);
  });

  it("clearing a learner removes only that learner's keys", async () => {
    await setTourSeen("a", true);
    await setTourSeen("b", true);
    await setDailyGoal("a", 20);
    await setActiveMinutes("a", { day: "2026-06-05", minutes: 3 });
    saved.set(STORE_KEYS.provider, "ollama");
    await clearLearnerStore("a");
    expect(await getTourSeen("a")).toBe(false);
    expect(await getDailyGoal("a")).toBeNull();
    expect(await getActiveMinutes("a")).toBeNull();
    expect(await getTourSeen("b")).toBe(true);
    expect(saved.get(STORE_KEYS.provider)).toBe("ollama");
  });

  it("the daily goal and today's minutes are per learner, and unset until chosen", async () => {
    expect(await getDailyGoal("a")).toBeNull();
    await setDailyGoal("a", 15);
    expect(await getDailyGoal("a")).toBe(15);
    expect(await getDailyGoal("b")).toBeNull();
    await setActiveMinutes("a", { day: "2026-06-05", minutes: 7 });
    expect(await getActiveMinutes("a")).toEqual({ day: "2026-06-05", minutes: 7 });
    expect(await getActiveMinutes("b")).toBeNull();
  });

  it("a garbage goal in the store reads as unset rather than crashing Home", async () => {
    saved.set(learnerStoreKey(STORE_KEYS.dailyGoalMinutes, "a"), "lots");
    expect(await getDailyGoal("a")).toBeNull();
    saved.set(learnerStoreKey(STORE_KEYS.activeMinutes, "a"), { minutes: "x" });
    expect(await getActiveMinutes("a")).toBeNull();
  });

  it("machine settings (provider, models, keys) are shared, not per learner", () => {
    for (const k of [STORE_KEYS.provider, STORE_KEYS.chatModel, STORE_KEYS.genModel, STORE_KEYS.ollamaUrl, apiKeyStoreKey("openai")]) {
      expect(LEARNER_SCOPED_KEYS).not.toContain(k);
    }
    expect(LEARNER_SCOPED_KEYS).toContain(STORE_KEYS.tourSeen);
    expect(LEARNER_SCOPED_KEYS).toContain(STORE_KEYS.dailyGoalMinutes);
    expect(LEARNER_SCOPED_KEYS).toContain(STORE_KEYS.activeMinutes);
  });

  it("a settings export carries no other learner's keys", async () => {
    saved.set(STORE_KEYS.provider, "ollama");
    await setTourSeen("a", true);
    const out = await gatherSettings(false);
    expect(out.settings[STORE_KEYS.provider]).toBe("ollama");
    expect(Object.keys(out.settings).some(isLearnerScopedKey)).toBe(false);
  });
});
