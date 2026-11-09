import { describe, it, expect } from "vitest";
import { askedThing, mentionedIn, notesMissThing, readsAsEnglish } from "./askedThing";
import { RAG_HELDOUT } from "../eval/rag-heldout";
import { RAG_PROBE_ITEMS } from "../eval/rag-probe";

// Lever 9e's extractor (askedThing.ts), ported from the frozen prototype with its logic unchanged.
// askedThing-parity.test.ts pins every dev and probe decision; this file pins the behaviour by shape.
// Questions here are hand-written unless they name an eval item by id.

const phrase = (q: string) => askedThing(q)?.phrase ?? null;
const thing = (q: string) => {
  const t = askedThing(q);
  if (!t) throw new Error(`no thing parsed from ${q}`);
  return t;
};

describe("askedThing", () => {
  it("names the thing an English lookup asks about", () => {
    for (const [q, want] of [
      ["How long does a gecko take to regrow its tail?", "gecko"],
      ["How often does Old Faithful erupt?", "old faithful"],
      ["How tall is an adult giraffe?", "adult giraffe"],
      ["What is the melting point of iron?", "iron"],
      ["Ethanol boils at what temperature?", "ethanol"],
      ["When was the Peace of Westphalia signed?", "westphalia"],
    ]) expect(phrase(q), q).toBe(want);
  });

  it("returns null when it cannot tell: a pronoun, the student's own record, an attribute, another language", () => {
    expect(phrase("how tall is it?")).toBeNull();
    expect(phrase("what did we record for the soil pH last week?")).toBeNull();
    expect(phrase("what's the healthy cut-off?")).toBeNull();
    const devOther = RAG_HELDOUT.filter((q) => q.split === "dev" && (q.lang === "fr" || q.lang === "hi"));
    expect(devOther.length).toBeGreaterThan(0);
    for (const q of devOther) {
      expect(phrase(q.ask), q.id).toBeNull();
      expect(notesMissThing(q.ask, ["Any passage at all."]), q.id).toEqual({ fire: false, thing: null });
    }
    expect(readsAsEnglish("¿Cuál es la capital de Francia?")).toBe(false);
  });

  // Found on the probe after the freeze. Not to be fixed before lever 9e's pre-registered run: the
  // extractor is frozen, and these two positives are predicted false fires in the pre-registration.
  it("keeps the two known probe parse bugs (bp-tol-1, bp-sor-2) as they are", () => {
    const ask = (id: string) => RAG_PROBE_ITEMS.find((x) => x.id === id)!.ask;
    expect(phrase(ask("bp-tol-1"))).toBe("doctrine saying municipal charters can't"); // a contraction does not end the phrase
    expect(phrase(ask("bp-sor-2"))).toBe("traditionally tuned slightly flat"); // "which string is <predicate>" takes the predicate
  });
});

describe("mentionedIn (cover: every content word in one passage)", () => {
  it("folds plurals, -ed, -ing and -ies", () => {
    expect(mentionedIn(thing("How long do geckos live?"), ["A gecko can live for twenty years."])).toBe(true);
    expect(mentionedIn(thing("How long does salted butter keep?"), ["We salt the butter by hand."])).toBe(true);
    expect(mentionedIn(thing("How much does baking soda cost?"), ["Bake it with a pinch of soda."])).toBe(true);
    expect(mentionedIn(thing("How tall do daisies grow?"), ["A daisy stays small."])).toBe(true);
  });

  it("splits hyphens and needs every part in the same passage", () => {
    const t = thing("How hot does seed-husk oil get?");
    expect(t.phrase).toBe("seed-husk oil");
    expect(mentionedIn(t, ["The oil is pressed from the husk of a seed."])).toBe(true);
    expect(mentionedIn(t, ["The oil is pressed from a seed.", "A husk is dry."])).toBe(false);
  });

  it("matches whole words only", () => {
    const t = thing("What is the melting point of copper?");
    expect(t.phrase).toBe("copper");
    expect(mentionedIn(t, ["A copperhead is a snake."])).toBe(false);
    expect(mentionedIn(t, ["The old copper wire was replaced."])).toBe(true);
  });
});

describe("notesMissThing", () => {
  it("fires only when a thing was parsed and no passage covers it", () => {
    expect(notesMissThing("How long does a gecko take to regrow its tail?", ["The newt regrows its tail in 17 days."])).toMatchObject({ fire: true, thing: { phrase: "gecko" } });
    expect(notesMissThing("How long does a gecko take to regrow its tail?", ["A gecko regrows its tail in weeks."])).toMatchObject({ fire: false, thing: { phrase: "gecko" } });
    expect(notesMissThing("How long does a gecko take to regrow its tail?", [])).toEqual({ fire: false, thing: null });
    expect(notesMissThing("how tall is it?", ["Anything."])).toEqual({ fire: false, thing: null });
  });
});
