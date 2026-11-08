import { describe, it, expect } from "vitest";
import { K12_FLOW_T3, type ChatMessage, type K12FlowTurnFn, type K12FlowTurnOutput } from "./k12-flow";
import { formatK12FlowFrT1, formatK12FlowFrT2, runK12FlowFr, runK12FlowFrItem } from "./k12-flow-fr";
import { K12_FR_ITEMS, type K12FrItem } from "./k12-flow-fr-items";

const ITEM = K12_FR_ITEMS.find((x) => x.id === "fr-math-k5-06")!; // 125 muffins, 8 a box: 16; T2 tries 15

const reply = (text: string, over: Partial<K12FlowTurnOutput> = {}): K12FlowTurnOutput => ({ text, stopReason: "complete", hits: [], usedHits: [], ttftMs: 5, ...over });

function scripted(replies: Array<K12FlowTurnOutput | Error>) {
  const calls: Array<{ messages: ChatMessage[]; item: K12FrItem }> = [];
  const turn: K12FlowTurnFn<K12FrItem> = async (messages, item) => {
    calls.push({ messages, item });
    const next = replies.shift();
    if (!next) throw new Error("no more scripted replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { turn, calls };
}

const T1_ASKS = "Each box holds 8 muffins. How many full boxes can you make from 125?";
const T2_ASKS = "Not quite: 15 boxes hold 120 muffins. Where do the other 5 go?";
const T3_SHOWS = "125 ÷ 8 = 15 remainder 5, and the 5 need one more box.\n\nFinal answer: 16 boxes";

describe("the turn texts", () => {
  it("T1 is the typed problem alone: no options, no 'Which one is right?'", () => {
    expect(formatK12FlowFrT1(ITEM)).toBe(ITEM.ask);
    expect(formatK12FlowFrT1(ITEM)).not.toMatch(/\bA\)|Which one is right/);
  });
  it("T2 claims the scripted wrong number with its unit", () => {
    expect(formatK12FlowFrT2(ITEM)).toBe("I think it's 15.");
    expect(formatK12FlowFrT2(K12_FR_ITEMS.find((x) => x.id === "fr-math-k5-08")!)).toBe("I think it's 64 beads.");
  });
});

describe("runK12FlowFrItem", () => {
  it("sends the three turns with ChatTab's history, offers the chip after a question, and grades the replies", async () => {
    const { turn, calls } = scripted([reply(T1_ASKS), reply(T2_ASKS), reply(T3_SHOWS, { workedAnswerRules: true })]);
    const row = await runK12FlowFrItem(ITEM, turn);
    expect(calls.map((c) => c.messages.map((m) => m.content))).toEqual([
      [ITEM.ask],
      [ITEM.ask, T1_ASKS, "I think it's 15."],
      [ITEM.ask, T1_ASKS, "I think it's 15.", T2_ASKS, K12_FLOW_T3],
    ]);
    expect(calls.every((c) => c.item === ITEM)).toBe(true);
    expect(row).toMatchObject({
      id: "fr-math-k5-06", source: "math-k5-06", key: "16", attempted: "15",
      studentAttempted: true, chipOffered: true, workedAnswerTurn: true, t3WorkedAnswerRules: true,
    });
    expect(row.grade).toMatchObject({ g1: true, g2: true, g3: true, pass: true, t3Answer: { value: 16 } });
    expect(row.turns.map((t) => t.user)).toEqual([ITEM.ask, "I think it's 15.", K12_FLOW_T3]);
  });

  it("does not offer the chip when T1 asked nothing, and records it", async () => {
    const { turn } = scripted([reply("You need 16 boxes because 125 ÷ 8 = 15 r 5."), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowFrItem(ITEM, turn);
    expect(row).toMatchObject({ studentAttempted: false, chipOffered: false, workedAnswerTurn: false });
    expect(row.grade).toMatchObject({ g1: false, g1Reason: "value" });
  });

  it("retries a turn with no reply once, then makes an ERROR row and stops", async () => {
    const { turn, calls } = scripted([reply(T1_ASKS), reply(""), new Error("stalled")]);
    const row = await runK12FlowFrItem(ITEM, turn);
    expect(calls).toHaveLength(3);
    expect(row.grade).toBeNull();
    expect(row.turns[1]).toMatchObject({ attempts: 2, error: "stalled" });
  });
});

describe("runK12FlowFr", () => {
  it("runs every item in order and summarises with ERROR rows as fails", async () => {
    const items = K12_FR_ITEMS.slice(0, 3);
    const turn: K12FlowTurnFn<K12FrItem> = async (messages, item) => {
      if (item === items[2]) throw new Error("down");
      const n = messages.filter((m) => m.role === "user").length;
      return reply(n < 3 ? "What do you get when you try it?" : "I worked it out. That is it.");
    };
    const seen: string[] = [];
    const { rows, summary } = await runK12FlowFr(items, turn, { onRow: (r) => seen.push(r.id) });
    expect(seen).toEqual(items.map((x) => x.id));
    expect(rows[2].grade).toBeNull();
    expect(summary).toMatchObject({ items: 3, errors: 1 });
    expect(summary.headline).toMatchObject({ k: 0, n: 3 });
    expect(summary.g5).toMatchObject({ k: 0, n: 2 });
  });
});
