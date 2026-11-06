import { describe, it, expect } from "vitest";
import { RAG_FIXTURE, RAG_QUESTIONS, scoreRagAnswer } from "./rag-fixture";
import { RAG_HELDOUT, split, type HeldoutGroup } from "./rag-heldout";

const byGroup = (g: HeldoutGroup) => RAG_HELDOUT.filter((x) => x.group === g);
const noteText = (title: string) => RAG_FIXTURE.find((n) => n.title === title)?.text.toLowerCase();

describe("held-out fixture shape", () => {
  it("has the advertised counts", () => {
    expect(byGroup("near-miss")).toHaveLength(36);
    expect(byGroup("far")).toHaveLength(8);
    expect(byGroup("crosslingual")).toHaveLength(24);
    expect(byGroup("paraphrase")).toHaveLength(16);
    for (const lang of ["es", "fr", "hi", "sw", "ar", "am"]) {
      expect(RAG_HELDOUT.filter((x) => x.lang === lang), lang).toHaveLength(4);
    }
  });

  it("ids are unique, follow the group prefix, and never collide with the main fixture", () => {
    const ids = RAG_HELDOUT.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const prefix: Record<HeldoutGroup, RegExp> = {
      "near-miss": /^h-nm\d{2}$/,
      far: /^h-fn\d{2}$/,
      crosslingual: /^h-xl-(es|fr|hi|sw|ar|am)\d{2}$/,
      paraphrase: /^h-pp\d{2}$/,
    };
    for (const x of RAG_HELDOUT) expect(x.id, x.id).toMatch(prefix[x.group]);
    for (const x of RAG_HELDOUT.filter((x) => x.lang)) expect(x.id).toContain(`-${x.lang}`);
    const mainIds = new Set(RAG_QUESTIONS.map((q) => q.id));
    const mainAsks = new Set(RAG_QUESTIONS.map((q) => q.ask.toLowerCase()));
    for (const x of RAG_HELDOUT) {
      expect(mainIds.has(x.id), x.id).toBe(false);
      expect(mainAsks.has(x.ask.toLowerCase()), x.id).toBe(false);
    }
  });

  it("every item names a real vault note, and near-misses cover all twelve", () => {
    const titles = new Set(RAG_FIXTURE.map((n) => n.title));
    for (const x of RAG_HELDOUT) expect(titles.has(x.note), `${x.id} → ${x.note}`).toBe(true);
    expect(new Set(byGroup("near-miss").map((x) => x.note)).size).toBe(RAG_FIXTURE.length);
  });
});

describe("splits", () => {
  it("follow the fixed rule: odd ordinal → dev, even → test", () => {
    for (const x of RAG_HELDOUT) expect(x.split, x.id).toBe(split(x.id));
    expect(split("h-nm01")).toBe("dev");
    expect(split("h-xl-ar04")).toBe("test");
  });

  it("are balanced within every group and every language", () => {
    const buckets = new Map<string, { dev: number; test: number }>();
    for (const x of RAG_HELDOUT) {
      for (const key of [x.group, x.lang && `lang:${x.lang}`]) {
        if (!key) continue;
        const b = buckets.get(key) ?? { dev: 0, test: 0 };
        b[x.split]++;
        buckets.set(key, b);
      }
    }
    expect(buckets.size).toBe(4 + 6);
    for (const [key, b] of buckets) expect(b.dev, key).toBe(b.test);
  });
});

describe("answerability", () => {
  it("every positive has an expect (and no poison) whose note-spelling appears in its own note", () => {
    for (const x of RAG_HELDOUT.filter((x) => x.kind !== "negative")) {
      expect(x.poison, x.id).toBeUndefined();
      const canonical = (x.expect ?? "").split("|")[0].trim().toLowerCase();
      expect(canonical, x.id).toBeTruthy();
      expect(noteText(x.note), `${x.id} expects ${canonical}`).toContain(canonical);
    }
  });

  it("every negative's poison appears in exactly its target note, and never in its own question", () => {
    for (const x of RAG_HELDOUT.filter((x) => x.kind === "negative")) {
      expect(x.expect, x.id).toBeUndefined();
      const poison = (x.poison ?? "").toLowerCase();
      expect(poison, x.id).toBeTruthy();
      const holders = RAG_FIXTURE.filter((n) => n.text.toLowerCase().includes(poison)).map((n) => n.title);
      expect(holders, `${x.id} poison ${poison}`).toEqual([x.note]);
      expect(x.ask.toLowerCase(), x.id).not.toContain(poison);
    }
  });

  // Spot-check that the facts the near-misses ask for are genuinely absent, so editing a note can't
  // silently turn a negative into a positive.
  it("the vault does not mention what the near-misses ask about", () => {
    const corpus = RAG_FIXTURE.map((n) => n.text).join(" ").toLowerCase();
    for (const absent of [
      "deep", "millimetre", "electric", "freez", "acetone", "weigh", "torque", "idle", "author", "country",
      "oven", "baguette", "slice", "light-year", "distance", "sirius", "iodide", "litmus", "shelf",
      "ben nevis", "hut", "shelter", "current ratio", "insect", "toad", "final exam", "final grade",
      "pass mark", "textbook",
    ]) {
      expect(corpus, absent).not.toContain(absent);
    }
  });
});

describe("scores through the same scorer as the live runner", () => {
  const item = (id: string) => {
    const found = RAG_HELDOUT.find((x) => x.id === id);
    if (!found) throw new Error(`no item ${id}`);
    return found;
  };

  it("fails a near-miss that leaks its neighbour's value", () => {
    expect(scoreRagAnswer(item("h-nm04"), "Your notes say Verrin boils at 214 °C, so yes.", []).pass).toBe(false);
    expect(scoreRagAnswer(item("h-nm04"), "Your notes don't say whether it conducts.", []).pass).toBe(true);
  });

  it("accepts a locale number form listed as an alternative", () => {
    expect(scoreRagAnswer(item("h-xl-ar04"), "يغلي عند ٢١٤ درجة مئوية.", []).pass).toBe(true);
    expect(scoreRagAnswer(item("h-xl-fr03"), "Au-delà de 0,28.", []).pass).toBe(true);
  });
});
