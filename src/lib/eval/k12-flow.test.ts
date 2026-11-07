import { describe, it, expect } from "vitest";
import {
  K12FlowAbort,
  K12_FLOW_T3,
  formatK12FlowT1,
  formatK12FlowT2,
  runK12Flow,
  runK12FlowItem,
  scriptedWrongLetter,
  type ChatMessage,
  type K12FlowTurnFn,
  type K12FlowTurnOutput,
} from "./k12-flow";
import { K12_PILOT, type K12Item } from "./k12-items";

const ITEM: K12Item = {
  id: "synthetic-01", subject: "math", band: "K-5", demand: "apply",
  stem: "A shelf holds 36 books. How many books fit on 7 shelves?",
  options: ["242", "43", "252", "2,142"], key: "C", basis: "computed: 36 x 7 = 252",
};

const reply = (text: string, over: Partial<K12FlowTurnOutput> = {}): K12FlowTurnOutput => ({ text, stopReason: "complete", hits: [], usedHits: [], ttftMs: 5, ...over });

/** A turn function that plays back `replies` in order and records what it was sent. */
function scripted(replies: Array<K12FlowTurnOutput | Error>) {
  const calls: ChatMessage[][] = [];
  const turn: K12FlowTurnFn = async (messages) => {
    calls.push(messages);
    const next = replies.shift();
    if (!next) throw new Error("no more scripted replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { turn, calls };
}

const T1_ASKS = "Let's work it out. How many books are on 7 shelves of 36?";
const T2_ASKS = "Not quite, 2,142 is too many. What is 36 × 7?";
const T3_SHOWS = "36 × 7 = 252. The correct answer is C) 252.";

describe("the frozen turn texts", () => {
  it("T1 is the stem, four lettered options and the question", () => {
    expect(formatK12FlowT1(ITEM)).toBe(
      "A shelf holds 36 books. How many books fit on 7 shelves?\n\nA) 242\nB) 43\nC) 252\nD) 2,142\n\nWhich one is right?",
    );
  });

  it("T2 picks the first non-key letter after the key, wrapping D to A", () => {
    expect(["A", "B", "C", "D"].map((k) => scriptedWrongLetter(k as K12Item["key"]))).toEqual(["B", "C", "D", "A"]);
    expect(formatK12FlowT2(ITEM)).toBe("I think it's D.");
  });

  it("T3 is the show-answer chip's message", () => {
    expect(K12_FLOW_T3).toBe("Show me the full worked answer.");
  });
});

describe("runK12FlowItem", () => {
  it("sends each turn with the history ChatTab would hold, and grades the three replies", async () => {
    const { turn, calls } = scripted([reply(T1_ASKS), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(calls.map((c) => c.map((m) => m.role))).toEqual([
      ["user"],
      ["user", "assistant", "user"],
      ["user", "assistant", "user", "assistant", "user"],
    ]);
    expect(calls[2].map((m) => m.content)).toEqual([formatK12FlowT1(ITEM), T1_ASKS, "I think it's D.", T2_ASKS, K12_FLOW_T3]);
    expect(row).toMatchObject({ id: "synthetic-01", key: "C", attempted: "D", studentAttempted: true, chipOffered: true });
    expect(row.grade).toMatchObject({ g1: true, g1b: true, g2: true, g3: true, g4: true, g5: true, pass: true });
  });

  it("offers no chip when T1 did not ask, because then T2 is not a try", async () => {
    const { turn } = scripted([reply("Multiply 36 by 7 to find the total number of books."), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(row.studentAttempted).toBe(false);
    expect(row.chipOffered).toBe(false);
    expect(row.grade?.g1b).toBe(false);
  });

  it("offers no chip when T2 does not end with a question", async () => {
    const { turn } = scripted([reply(T1_ASKS), reply("Not quite. 36 × 7 is not 2,142. Multiply again and see what you get."), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(row.studentAttempted).toBe(true);
    expect(row.chipOffered).toBe(false);
  });

  it("keeps the cut-off marker in history, which closes the question like it does in ChatTab", async () => {
    const { turn, calls } = scripted([reply(T1_ASKS, { stopReason: "length" }), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(calls[1][1].content).toBe(`${T1_ASKS}\n\n_[cut off at the length limit — ask the tutor to continue]_`);
    expect(row.studentAttempted).toBe(false);
    // Graded on the text the model produced, not on the marker.
    expect(row.grade?.g1b).toBe(true);
  });

  it("records the kernel's worked-answer gate for T3, and it equals the chip", async () => {
    const cases: Array<[string, K12FlowTurnOutput[], boolean]> = [
      ["chip offered", [reply(T1_ASKS), reply(T2_ASKS), reply(T3_SHOWS)], true],
      ["T1 did not ask", [reply("Multiply 36 by 7 to find the total number of books."), reply(T2_ASKS), reply(T3_SHOWS)], false],
      ["T2 did not ask", [reply(T1_ASKS), reply("Not quite. 36 × 7 is not 2,142. Multiply again and see what you get."), reply(T3_SHOWS)], false],
      ["T2 cut at the length limit, on a question", [reply(T1_ASKS), reply(T2_ASKS, { stopReason: "length" }), reply(T3_SHOWS)], true],
    ];
    for (const [name, replies, expected] of cases) {
      const row = await runK12FlowItem(ITEM, scripted(replies).turn);
      expect(row.chipOffered, name).toBe(expected);
      expect(row.workedAnswerTurn, name).toBe(expected);
    }
  });

  it("retries an empty reply, because an empty T1 or T2 would pass G1 and G2", async () => {
    const { turn, calls } = scripted([reply("  "), reply(T1_ASKS), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(calls[1].map((m) => m.role)).toEqual(["user"]);
    expect(row.turns.map((t) => t.attempts)).toEqual([2, 1, 1]);
    expect(row.grade?.pass).toBe(true);
  });

  it("makes an ERROR row when a turn is empty twice", async () => {
    const { turn } = scripted([reply(T1_ASKS), reply(""), reply("")]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(row.grade).toBeNull();
    expect(row.turns[1]).toMatchObject({ attempts: 2, error: "empty reply" });
  });

  it("hands the turn function the item, so the runner can build that item's system prompt", async () => {
    const seen: string[] = [];
    const turn: K12FlowTurnFn = async (_m, item) => {
      seen.push(item.id);
      return reply(T1_ASKS);
    };
    await runK12FlowItem(ITEM, turn);
    expect(seen).toEqual(["synthetic-01", "synthetic-01", "synthetic-01"]);
  });

  it("retries a turn that produced no reply once", async () => {
    const { turn } = scripted([new Error("connection reset"), reply(T1_ASKS), reply(T2_ASKS), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(row.turns.map((t) => t.attempts)).toEqual([2, 1, 1]);
    expect(row.grade?.pass).toBe(true);
  });

  it("makes an ERROR row when a turn fails twice, and stops the item there", async () => {
    const { turn, calls } = scripted([reply(T1_ASKS), reply("", { stopReason: "stalled" }), reply("partial", { stopReason: "aborted" })]);
    const row = await runK12FlowItem(ITEM, turn);
    expect(calls).toHaveLength(3);
    expect(row.grade).toBeNull();
    expect(row.chipOffered).toBeNull();
    expect(row.turns).toHaveLength(2);
    expect(row.turns[1]).toMatchObject({ attempts: 2, error: "turn aborted" });
  });

  it("lets K12FlowAbort end the run instead of becoming an ERROR row", async () => {
    const { turn } = scripted([new K12FlowAbort("guard tripped")]);
    await expect(runK12FlowItem(ITEM, turn)).rejects.toThrow("guard tripped");
  });

  it("records the turn's TTFT and the wall time around it", async () => {
    let t = 1000;
    const now = () => (t += 250);
    const { turn } = scripted([reply(T1_ASKS, { ttftMs: 40 }), reply(T2_ASKS, { ttftMs: null }), reply(T3_SHOWS)]);
    const row = await runK12FlowItem(ITEM, turn, now);
    expect(row.turns.map((x) => [x.ttftMs, x.totalMs])).toEqual([[40, 250], [null, 250], [5, 250]]);
  });
});

describe("runK12Flow", () => {
  it("runs every pilot item through all three turns and summarises", async () => {
    // A tutor that asks at T1, corrects at T2 and states the key at T3: everything should pass.
    const turn: K12FlowTurnFn = async (messages) => {
      const t1 = messages[0].content;
      const n = messages.length;
      if (n === 1) return reply("Let's think it through together. Which option fits, and why?");
      if (n === 3) return reply("Not quite. Look at that option again. What does the question ask for?");
      const item = K12_PILOT.find((x) => t1.startsWith(x.stem))!;
      return reply(`Here is the worked answer.\n\nFinal answer: ${item.key}`);
    };
    const seen: string[] = [];
    const { rows, summary } = await runK12Flow(K12_PILOT, turn, { onRow: (r) => seen.push(r.id) });
    expect(seen).toEqual(K12_PILOT.map((x) => x.id));
    expect(rows.every((r) => r.attempted !== r.key)).toBe(true);
    expect(summary.headline).toMatchObject({ k: 12, n: 12 });
    expect(summary.chipOffered).toMatchObject({ k: 12, n: 12 });
    expect(summary.errors).toBe(0);
  });
});
