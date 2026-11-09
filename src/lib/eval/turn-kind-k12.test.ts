// Where the fact-lookup note can reach the k12-flow benchmarks. Lever 9b's MC guard (PR #205) ran the
// whole k12-flow suite to check that the classifier leaves attempt-first alone; this pins, by code, which
// k12-flow (MC, 240 items) and k12-flow-fr (81 items) turns the classifier calls a fact lookup, so a
// change to the lookup note's wording alone can be judged without re-running those suites.
import { describe, expect, it } from "vitest";
import { classifyTurn } from "../kernel/turnKind";
import { K12_ITEMS } from "./k12-items";
import { K12_FR_ITEMS } from "./k12-flow-fr-items";
import { formatK12FlowT1, formatK12FlowT2, K12_FLOW_T3 } from "./k12-flow";
import { formatK12FlowFrT1, formatK12FlowFrT2 } from "./k12-flow-fr";

// A tutor reply in between, with and without a number; classifyTurn reads the newest message first.
const REPLIES = ["Good question. What do you notice first?", "Start with the first step: what is 3 + 4?"];

/** "<item index>:T<turn>" for every turn the classifier calls a fact lookup, after either reply. */
function lookups(t1s: string[], t2s: string[]): string[] {
  const hits = new Set<string>();
  t1s.forEach((t1, i) => {
    for (const reply of REPLIES) {
      const turns = [
        [{ role: "user", content: t1 }],
        [{ role: "user", content: t1 }, { role: "assistant", content: reply }, { role: "user", content: t2s[i] }],
        [{ role: "user", content: t1 }, { role: "assistant", content: reply }, { role: "user", content: t2s[i] }, { role: "assistant", content: reply }, { role: "user", content: K12_FLOW_T3 }],
      ];
      turns.forEach((c, t) => { if (classifyTurn(c) === "fact-lookup") hits.add(`${i}:T${t + 1}`); });
    }
  });
  return [...hits];
}

describe("the fact-lookup note on the k12-flow suites", () => {
  it("never fires on a k12-flow MC turn (240 items, T1/T2/T3)", () => {
    expect(lookups(K12_ITEMS.map(formatK12FlowT1), K12_ITEMS.map(formatK12FlowT2))).toEqual([]);
  });
  // One known miss: a Punnett-square problem with no number to work with until the cross is done
  // ("what percentage of the offspring should have short stems?") reads as a lookup, so its T1 gets the
  // lookup note instead of no note. Pinned so a change shows up; not fixed here.
  it("fires on exactly one k12-flow-fr turn: fr-science-68-02's T1 (81 items, T1/T2/T3)", () => {
    const hits = lookups(K12_FR_ITEMS.map(formatK12FlowFrT1), K12_FR_ITEMS.map(formatK12FlowFrT2));
    expect(hits.map((h) => `${K12_FR_ITEMS[Number(h.split(":")[0])].id}:${h.split(":")[1]}`)).toEqual(["fr-science-68-02:T1"]);
  });
});
