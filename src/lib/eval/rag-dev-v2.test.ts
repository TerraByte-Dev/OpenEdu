import { describe, it, expect } from "vitest";
import { RAG_FIXTURE, RAG_QUESTIONS, scoreRagAnswer } from "./rag-fixture";
import { RAG_HELDOUT } from "./rag-heldout";
import {
  RAG_DEV_V2, RAG_DEV_V2_VAULT, RAG_DEV_V2_NAMES, REAL_WORLD_V1,
  containsAlternative, realWorldAnswered, realWorldExpect,
} from "./rag-dev-v2";
import { extractNames, findNameHits, englishWords, libraryVocabulary, type SealedSet } from "./sealed";
import { cwd, path } from "./headless/node-io";

const positives = RAG_DEV_V2.filter((x) => x.kind === "positive");
const nearMisses = RAG_DEV_V2.filter((x) => x.kind === "negative");
const noteText = (title: string) => RAG_DEV_V2_VAULT.find((n) => n.title === title)!.text;
const names = Object.values(RAG_DEV_V2_NAMES).map((n) => n.toLowerCase());
const alternatives = (s: string) => s.split("|").map((a) => a.trim()).filter(Boolean);
// The note that holds a value as a token (containsAlternative), so "47" is not found in "2.947".
const holders = (value: string) => RAG_DEV_V2_VAULT.filter((n) => containsAlternative(n.text, value)).map((n) => n.title);

describe("dev vault v2: shape", () => {
  it("has at least 18 name-free positives and 18 lowercase near-misses, all dev", () => {
    expect(positives.length).toBeGreaterThanOrEqual(18);
    expect(nearMisses.length).toBeGreaterThanOrEqual(18);
    expect(positives).toHaveLength(22);
    expect(nearMisses).toHaveLength(25);
    for (const x of RAG_DEV_V2) expect(x.split, x.id).toBe("dev");
    for (const x of positives) expect(x.group, x.id).toBe("paraphrase");
    for (const x of nearMisses) expect(x.group, x.id).toBe("near-miss");
  });

  it("ids are unique, follow the prefix, and collide with no v1 or main id or question", () => {
    const ids = RAG_DEV_V2.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of positives) expect(x.id).toMatch(/^v2-pf\d{2}$/);
    for (const x of nearMisses) expect(x.id).toMatch(/^v2-nl\d{2}$/);
    const oldIds = new Set([...RAG_HELDOUT, ...RAG_QUESTIONS].map((q) => q.id));
    const oldAsks = new Set([...RAG_HELDOUT, ...RAG_QUESTIONS].map((q) => q.ask.toLowerCase()));
    for (const x of RAG_DEV_V2) {
      expect(oldIds.has(x.id), x.id).toBe(false);
      expect(oldAsks.has(x.ask.toLowerCase()), x.id).toBe(false);
    }
  });

  it("every note has a distinctive name in its title and text, and every item names a vault note", () => {
    const titles = RAG_DEV_V2_VAULT.map((n) => n.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(Object.keys(RAG_DEV_V2_NAMES).sort()).toEqual([...titles].sort());
    for (const n of RAG_DEV_V2_VAULT) {
      const name = RAG_DEV_V2_NAMES[n.title];
      expect(n.title, n.title).toContain(name);
      expect(n.text, n.title).toContain(name);
    }
    for (const x of RAG_DEV_V2) expect(titles, x.id).toContain(x.note);
    // Every note is the gold of at least one name-free positive and the near note of a near-miss.
    for (const t of titles) {
      expect(positives.some((x) => x.note === t), t).toBe(true);
      expect(nearMisses.some((x) => x.note === t), t).toBe(true);
    }
  });

  it("no title or name is shared with the v1 vault", () => {
    const v1 = RAG_FIXTURE.map((n) => `${n.title} ${n.text}`.toLowerCase());
    for (const n of RAG_DEV_V2_VAULT) {
      expect(RAG_FIXTURE.some((o) => o.title === n.title), n.title).toBe(false);
      for (const text of v1) expect(text).not.toContain(RAG_DEV_V2_NAMES[n.title].toLowerCase());
    }
  });
});

describe("dev vault v2: name-free positives", () => {
  it("never contain any note's distinctive name, in any case, plural or possessive", () => {
    const hits = findNameHits(names, positives.map((x) => ({ path: x.id, text: x.ask })));
    expect(hits).toEqual([]);
  });

  it("expect the note's own value, which only their gold note holds", () => {
    for (const x of positives) {
      expect(x.poison, x.id).toBeUndefined();
      const alts = alternatives(x.expect ?? "");
      expect(alts.length, x.id).toBeGreaterThan(0);
      expect(noteText(x.note), `${x.id} expects ${alts[0]}`).toContain(alts[0]);
      for (const a of alts) expect(holders(a).filter((t) => t !== x.note), `${x.id}: ${a}`).toEqual([]);
      expect(holders(alts[0]), x.id).toEqual([x.note]);
      expect(containsAlternative(x.ask, x.expect!), `${x.id} gives its answer away`).toBeNull();
    }
  });
});

describe("dev vault v2: lowercase near-misses", () => {
  it("name a different entity in lower case, and no capital after the first letter", () => {
    for (const x of nearMisses) {
      expect(x.entity, x.id).toBeTruthy();
      expect(x.entity, x.id).toBe(x.entity!.toLowerCase());
      expect(x.ask, x.id).toContain(x.entity);
      expect(x.ask.slice(1), x.id).toBe(x.ask.slice(1).toLowerCase());
      const inVault = findNameHits([x.entity!], RAG_DEV_V2_VAULT.map((n) => ({ path: n.title, text: `${n.title} ${n.text}` })));
      expect(inVault, `${x.id}: ${x.entity}`).toEqual([]);
    }
    expect(findNameHits(names, nearMisses.map((x) => ({ path: x.id, text: x.ask })))).toEqual([]);
    // Roughly half are typed all in lower case.
    const allLower = nearMisses.filter((x) => x.ask === x.ask.toLowerCase()).length;
    expect(allLower).toBeGreaterThanOrEqual(10);
    expect(nearMisses.length - allLower).toBeGreaterThanOrEqual(10);
  });

  it("poison is in exactly the near note, never in the question", () => {
    for (const x of nearMisses) {
      const poison = (x.poison ?? "").toLowerCase();
      expect(poison, x.id).toBeTruthy();
      const inNotes = RAG_DEV_V2_VAULT.filter((n) => n.text.toLowerCase().includes(poison)).map((n) => n.title);
      expect(inNotes, `${x.id} poison ${poison}`).toEqual([x.note]);
      expect(x.ask.toLowerCase(), x.id).not.toContain(poison);
    }
  });

  it("a real-world answer is in no note, and never overlaps the poison", () => {
    const graded = nearMisses.filter((x) => !x.expect).map((x) => x.id);
    expect(graded).toEqual(["v2-nl03", "v2-nl16", "v2-nl17", "v2-nl18", "v2-nl24", "v2-nl25"]);
    for (const x of nearMisses.filter((x) => x.expect)) {
      for (const a of alternatives(x.expect!)) {
        expect(holders(a), `${x.id}: ${a}`).toEqual([]);
        expect(containsAlternative(x.poison!, a), `${x.id}: ${a} in poison`).toBeNull();
        expect(a.toLowerCase().includes(x.poison!.toLowerCase()), `${x.id}: poison in ${a}`).toBe(false);
      }
      expect(containsAlternative(x.ask, x.expect!), `${x.id} gives its answer away`).toBeNull();
    }
  });
});

describe("dev vault v2: name lint against the v1 dev and test items", () => {
  // The lint's own functions (sealed.ts), run the way loadSealed runs them, on public data only. The
  // sealed v2 set is not read here, or anywhere outside the frozen run script.
  const asSet = (notes: typeof RAG_FIXTURE, items: SealedSet["rag"]["items"]): SealedSet =>
    ({ schema: "openedu-heldout-v2", created: "", sealed: true, rag: { notes, items }, k12: { items: [] } });
  const v2Set = asSet(RAG_DEV_V2_VAULT, RAG_DEV_V2.map((x) => ({ ...x, split: "test" as const })));
  const v1Questions = [...RAG_HELDOUT, ...RAG_QUESTIONS.map((q) => ({ ...q, group: "paraphrase" as const, split: "dev" as const, note: "" }))];
  const v1Set = asSet(RAG_FIXTURE, v1Questions.map((x) => ({ ...x, split: "test" as const })));
  const files = (s: SealedSet) => [
    ...s.rag.notes.map((n) => ({ path: n.title, text: `${n.title}\n${n.text}` })),
    ...s.rag.items.map((x) => ({ path: x.id, text: [x.ask, x.expect, x.poison].filter(Boolean).join("\n") })),
  ];

  it("shares no made-up name or distinctive token with v1, in either direction", async () => {
    const ordinary = await libraryVocabulary((await path()).resolve(cwd(), "public", "library"));
    for (const w of await englishWords()) ordinary.add(w);
    const v2Tokens = extractNames(v2Set, ordinary);
    const v1Tokens = extractNames(v1Set, ordinary);
    // The lint sees every distinctive name as made up, so it would catch one that leaked into src/.
    for (const n of names) expect(v2Tokens, n).toContain(n);
    expect(v1Tokens).toContain("verrin");
    expect(findNameHits(v2Tokens, files(v1Set))).toEqual([]);
    expect(findNameHits(v1Tokens, files(v2Set))).toEqual([]);
  }, 30_000);
});

describe("real-world answered", () => {
  it("matches an alternative as a whole token", () => {
    expect(containsAlternative("It boils at about 290 °C.", "290")).toBe("290");
    expect(containsAlternative("Ashcombe is 1290 m.", "290")).toBeNull();
    expect(containsAlternative("About 0.78 of it.", "78")).toBeNull();
    expect(containsAlternative("Ethanol boils at 78.37 °C.", "78")).toBe("78");
    expect(containsAlternative("Sirius is at −1.46.", "1.46|1.5")).toBe("1.46");
    expect(containsAlternative("Magnitude −1.465 or so.", "1.46")).toBe("1.46");
    expect(containsAlternative("It is considered acidic.", "red|pink")).toBeNull();
    expect(containsAlternative("It turns RED.", "red|pink")).toBe("red");
    expect(containsAlternative("Mercury freezes at −38.83 °C.", "38.8|-39")).toBe("38.8");
    expect(containsAlternative("About 2% a year.", "2%")).toBe("2%");
    expect(containsAlternative("About 12% a year.", "2%")).toBeNull();
    expect(containsAlternative("It lasted nine days.", "nine days|9 days")).toBe("nine days");
    expect(containsAlternative("It lasted 19 days.", "nine days|9 days")).toBeNull();
  });

  it("uses an item's own expect, and the v1 list only on the v1 sets", () => {
    const glycerol = RAG_DEV_V2.find((x) => x.id === "v2-nl01")!;
    expect(realWorldExpect(glycerol, "dev-v2")).toBe("290");
    expect(realWorldAnswered(glycerol, "dev-v2", "Glycerol boils at 290 °C.")).toBe(true);
    expect(realWorldAnswered(glycerol, "dev-v2", "Your notes don't cover glycerol.")).toBe(false);
    expect(realWorldAnswered(RAG_DEV_V2.find((x) => x.id === "v2-nl03")!, "dev-v2", "Weeks.")).toBeNull();
    expect(realWorldAnswered(RAG_DEV_V2.find((x) => x.id === "v2-pf01")!, "dev-v2", "287")).toBeNull();
    const benNevis = RAG_HELDOUT.find((x) => x.id === "h-nm23")!;
    expect(realWorldAnswered(benNevis, "dev", "Ben Nevis is 1,345 metres high.")).toBe(true);
    expect(realWorldAnswered(benNevis, "dev", "I don't have the height of Ben Nevis in my notes.")).toBe(false);
    // Another set's item with the same id never picks up the v1 list.
    expect(realWorldExpect({ ...benNevis }, "sealed-v2")).toBeNull();
    expect(realWorldExpect(RAG_QUESTIONS.find((q) => q.id === "n1")!, "main")).toBeNull();
  });

  it("the v1 list covers only untouched v1 near-misses, and never holds a vault value", () => {
    for (const [id, expectList] of Object.entries(REAL_WORLD_V1)) {
      const q = RAG_HELDOUT.find((x) => x.id === id);
      expect(q, id).toBeTruthy();
      expect(q!.group, id).toBe("near-miss");
      expect(q!.expect, id).toBeUndefined();
      for (const a of alternatives(expectList)) {
        for (const n of RAG_FIXTURE) expect(containsAlternative(n.text, a), `${id}: ${a} in ${n.title}`).toBeNull();
        expect(containsAlternative(q!.poison!, a), id).toBeNull();
      }
    }
    // Dev split: the six crisp real-world near-misses behind B1's "over-refusal 8/18".
    expect(Object.keys(REAL_WORLD_V1).filter((id) => RAG_HELDOUT.find((x) => x.id === id)!.split === "dev").sort())
      .toEqual(["h-nm05", "h-nm11", "h-nm17", "h-nm23", "h-nm33", "h-nm35"]);
  });

  it("does not change the automatic scorer: a near-miss is still judged on chip and poison", () => {
    const glycerol = RAG_DEV_V2.find((x) => x.id === "v2-nl01")!;
    expect(scoreRagAnswer(glycerol, "Glycerol boils at 290 °C.", []).pass).toBe(true);
    expect(scoreRagAnswer(glycerol, "Your notes say 287 °C.", []).pass).toBe(false);
    expect(scoreRagAnswer(glycerol, "Glycerol boils at 290 °C.", ["Lab Log — Ostravine Oil"]).pass).toBe(false);
  });
});
