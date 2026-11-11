import { describe, it, expect } from "vitest";
import { ITEMS_BY_ID, SKILLS, choiceKey } from "./packs";
import { MASTERY_STREAK, skillProgress, tap, type AttemptRow } from "./engine";
import {
  CONFUSION_DAYS, CONFUSION_MIN, SESSION_GAP_MS, approxMinutes, daysPlayed, hardOnes, masteryDates, monthlyRecord,
  monthsWithAttempts, shortDate, sittings, skillReports, targetOf, weekSummary,
} from "./report";
import type { SkillId } from "./types";

// Rows are built from local times and stored the way SQLite's datetime('now') writes them (UTC), so the
// tests mean the same thing in every time zone.
const utc = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const at = (y: number, mo: number, d: number, h = 10, mi = 0, s = 0) => new Date(y, mo, d, h, mi, s);

// One stored tap, made the way the app makes it: engine.ts tap() on a real item.
function row(itemId: string, pick: string, firstTry: boolean, when: Date): AttemptRow {
  const item = ITEMS_BY_ID.get(itemId)!;
  const choice = item.choices.find((c) => choiceKey(c) === pick);
  if (!choice) throw new Error(`${pick} is not a choice of ${itemId}`);
  const a = tap(item, choice, firstTry).attempt;
  return { skill_id: a.skillId, item_id: a.itemId, correct: a.correct ? 1 : 0, first_try: a.firstTry ? 1 : 0, created_at: utc(when), choice: a.choice };
}
const right = (itemId: string, when: Date) => row(itemId, ITEMS_BY_ID.get(itemId)!.answer, true, when);

// MASTERY_STREAK right first tries in a skill, a minute apart from `start`.
function master(skill: SkillId, start: Date): AttemptRow[] {
  return SKILLS[skill].items.slice(0, MASTERY_STREAK).map((it, i) => right(it.id, new Date(start.getTime() + i * 60_000)));
}

describe("sittings and minutes", () => {
  it("splits sittings at a 5-minute gap and counts first-to-last tap in each", () => {
    const t0 = at(2026, 10, 10, 9);
    const rows = [
      right("colors/red", t0),
      right("colors/blue", new Date(t0.getTime() + 2 * 60_000)),
      right("colors/green", new Date(t0.getTime() + 4 * 60_000)), // sitting 1: 4 minutes
      right("colors/pink", new Date(t0.getTime() + 4 * 60_000 + SESSION_GAP_MS)), // exactly 5 min later: new sitting
      right("colors/brown", new Date(t0.getTime() + 7 * 60_000 + SESSION_GAP_MS)), // sitting 2: 3 minutes
    ];
    expect(sittings(rows).map((s) => s.taps)).toEqual([3, 2]);
    expect(approxMinutes(rows)).toBe(7);
  });

  it("counts a sitting of one tap as no time, and sorts rows by time first", () => {
    const t0 = at(2026, 10, 10, 9);
    expect(approxMinutes([right("colors/red", t0)])).toBe(0);
    const later = right("colors/blue", new Date(t0.getTime() + 90_000));
    expect(approxMinutes([later, right("colors/red", t0)])).toBe(2); // 1.5 min rounds to 2
    expect(approxMinutes([])).toBe(0);
  });

  it("counts days by the learner's local calendar", () => {
    expect(daysPlayed([right("colors/red", at(2026, 10, 9, 23, 50)), right("colors/red", at(2026, 10, 10, 0, 10))])).toBe(2);
    expect(daysPlayed([right("colors/red", at(2026, 10, 9, 8)), right("colors/red", at(2026, 10, 9, 20))])).toBe(1);
  });
});

describe("masteryDates", () => {
  it("dates mastery at the answer that completed the streak, and agrees with skillProgress", () => {
    const start = at(2026, 10, 3, 9);
    const rows = [row("colors/red", "color:yellow", true, at(2026, 10, 2)), ...master("colors", start)];
    const dates = masteryDates(rows);
    expect(dates.colors?.getTime()).toBe(new Date(start.getTime() + (MASTERY_STREAK - 1) * 60_000).getTime());
    const progress = skillProgress(rows);
    for (const id of Object.keys(SKILLS) as SkillId[]) expect(dates[id] !== null, id).toBe(progress[id].mastered);
  });

  it("keeps the first mastery date when the learner plays on", () => {
    const rows = [...master("shapes", at(2026, 10, 3)), ...master("shapes", at(2026, 10, 8))];
    expect(masteryDates(rows).shapes?.getDate()).toBe(3);
  });
});

describe("weekSummary", () => {
  const now = at(2026, 10, 11, 18);

  it("covers today and the six days before, from the stored rows only", () => {
    const rows = [
      right("colors/red", at(2026, 10, 4, 23, 59)), // 7 days back: outside
      right("colors/red", at(2026, 10, 5, 9)),
      right("colors/blue", at(2026, 10, 5, 9, 3)),
      right("shapes/star", at(2026, 10, 11, 8)),
    ];
    const w = weekSummary(rows, now);
    expect(w.from).toEqual(at(2026, 10, 5, 0));
    expect(w.daysPlayed).toBe(2);
    expect(w.minutes).toBe(3);
    expect(w.sittings).toBe(2);
    expect(w.mastered).toEqual([]);
  });

  it("lists the skills mastered in the window, not before it", () => {
    const rows = [...master("colors", at(2026, 10, 1)), ...master("count-1-10", at(2026, 10, 9))];
    expect(weekSummary(rows, now).mastered).toEqual(["count-1-10"]);
  });

  it("is all zeros for a learner who has not played", () => {
    expect(weekSummary([], now)).toMatchObject({ daysPlayed: 0, minutes: 0, sittings: 0, mastered: [] });
  });
});

describe("skillReports", () => {
  it("lists every skill in pack order, not yet, with count-11-20 waiting on count-1-10", () => {
    const r = skillReports([]);
    expect(r.map((s) => s.id)).toEqual(Object.keys(SKILLS));
    expect(r.every((s) => s.status === "not-yet" && s.pct === 0)).toBe(true);
    expect(r.find((s) => s.id === "count-11-20")).toMatchObject({ locked: true, detail: "Opens after counting to 10" });
    expect(r.find((s) => s.id === "colors")).toMatchObject({ title: "Colors", locked: false, detail: "Not played yet" });
  });

  it("counts targets right on the first try, never retries, for a skill being learned", () => {
    const t = at(2026, 10, 10);
    const rows = [
      right("colors/red", t),
      right("colors/red", t),
      row("colors/blue", "color:yellow", true, t),
      row("colors/blue", "color:blue", false, t), // right after a retry: not counted
      right("colors/green", t),
    ];
    const colors = skillReports(rows).find((s) => s.id === "colors")!;
    expect(colors).toMatchObject({ status: "learning", known: 2, of: 8, pct: 25, detail: "2 of 8 colors right on the first try" });
  });

  it("counts a number once whichever way it was asked", () => {
    const t = at(2026, 10, 10);
    const r = skillReports([right("count-1-10/how-many-4", t), right("count-1-10/find-4", t)]);
    expect(r.find((s) => s.id === "count-1-10")).toMatchObject({ known: 1, of: 10, detail: "1 of 10 numbers right on the first try" });
  });

  it("shows a mastered skill at 100 with its date, and opens the next one", () => {
    const rows = master("count-1-10", at(2026, 10, 9, 9));
    const r = skillReports(rows);
    expect(r.find((s) => s.id === "count-1-10")).toMatchObject({ status: "mastered", pct: 100, detail: `Mastered on ${shortDate(at(2026, 10, 9))}` });
    expect(r.find((s) => s.id === "count-11-20")).toMatchObject({ status: "not-yet", locked: false, detail: "Not played yet" });
  });

  it("adds the skill's mix-up to its line", () => {
    const t = at(2026, 10, 10);
    const r = skillReports([right("colors/red", t)], [{ skillId: "colors", a: "pink", b: "red", times: 3 }]);
    expect(r[0].detail).toBe("1 of 8 colors right on the first try; mixes up pink and red");
  });
});

describe("hardOnes", () => {
  const now = at(2026, 10, 11, 18);
  const pinkAsRed = (when: Date) => row("colors/pink", "color:red", true, when);
  const redAsPink = (when: Date) => row("colors/red", "color:yellow", true, when); // red's choices have no pink

  it(`shows a pair only at ${CONFUSION_MIN} wrong first tries, counted either way round`, () => {
    const t = at(2026, 10, 10);
    const twice = [pinkAsRed(t), pinkAsRed(t)];
    expect(hardOnes(twice, now)).toEqual([]);
    // 13 asked, 14 tapped; then 14 asked, 13 tapped: the same pair.
    const rows = [
      row("count-11-20/how-many-13", "n:14", true, t),
      row("count-11-20/how-many-14", "n:13", true, t),
      row("count-11-20/find-13", "dots:14", true, t),
      ...twice,
    ];
    expect(hardOnes(rows, now)).toEqual([{ skillId: "count-11-20", a: "13", b: "14", times: 3 }]);
  });

  it("ignores retries, right answers, other pairs and rows with no stored choice", () => {
    const t = at(2026, 10, 10);
    const rows = [
      pinkAsRed(t), pinkAsRed(t),
      row("colors/pink", "color:red", false, t),       // a retry
      right("colors/pink", t),                          // right
      redAsPink(t),                                     // a different pair (red, yellow)
      { ...pinkAsRed(t), choice: null },                // before migration 17
    ];
    expect(hardOnes(rows, now)).toEqual([]);
  });

  it(`forgets mix-ups older than ${CONFUSION_DAYS} days`, () => {
    const old = new Date(now.getTime() - (CONFUSION_DAYS + 1) * 86_400_000);
    expect(hardOnes([pinkAsRed(old), pinkAsRed(old), pinkAsRed(old)], now)).toEqual([]);
    expect(hardOnes([pinkAsRed(old), pinkAsRed(now), pinkAsRed(now), pinkAsRed(now)], now)).toHaveLength(1);
  });

  it("puts the most frequent mix-up first", () => {
    const t = at(2026, 10, 10);
    const rows = [
      ...Array.from({ length: 3 }, () => pinkAsRed(t)),
      ...Array.from({ length: 4 }, () => row("shapes/square", "shape:rectangle", true, t)),
    ];
    expect(hardOnes(rows, now).map((c) => [c.a, c.b, c.times])).toEqual([["rectangle", "square", 4], ["pink", "red", 3]]);
  });

  it("reads a target from any choice key", () => {
    expect(["n:14", "dots:14", "color:red", "shape:star"].map(targetOf)).toEqual(["14", "14", "red", "star"]);
  });
});

describe("monthlyRecord", () => {
  const rows = [
    ...master("colors", at(2026, 9, 20, 9)),                  // October: mastered colors
    right("count-1-10/how-many-3", at(2026, 9, 21, 9)),
    ...master("count-1-10", at(2026, 10, 3, 9)),              // November: mastered counting to 10
    right("shapes/star", at(2026, 10, 4, 9)),
    right("shapes/heart", at(2026, 10, 4, 9, 2)),
    right("shapes/heart", at(2026, 11, 1, 9)),                // December
  ];

  it("lists the months with taps, newest first", () => {
    expect(monthsWithAttempts(rows)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 10 }, { year: 2026, month: 9 }]);
  });

  it("records one month from the rows: days, time, mastered with dates, in progress, mastered before", () => {
    const r = monthlyRecord(rows, { year: 2026, month: 10 });
    expect(r.label).toBe("November 2026");
    expect(r.daysPlayed).toBe(2);
    expect(r.minutes).toBe(4 + 2); // the counting streak spans 4 minutes, the shapes sitting 2
    expect(r.mastered.map((m) => [m.id, m.on.getDate()])).toEqual([["count-1-10", 3]]);
    expect(r.inProgress).toEqual([{ id: "shapes", title: "Shapes", detail: "2 of 6 shapes right on the first try so far" }]);
    expect(r.masteredBefore.map((m) => m.id)).toEqual(["colors"]);
  });

  it("judges each month as it stood at its end, not as things are now", () => {
    const oct = monthlyRecord(rows, { year: 2026, month: 9 });
    expect(oct.mastered.map((m) => m.id)).toEqual(["colors"]);
    expect(oct.inProgress.map((p) => [p.id, p.detail])).toEqual([["count-1-10", "1 of 10 numbers right on the first try so far"]]);
    expect(oct.masteredBefore).toEqual([]);
  });

  it("is empty for a month with no taps", () => {
    expect(monthlyRecord(rows, { year: 2026, month: 5 })).toMatchObject({ daysPlayed: 0, minutes: 0, mastered: [], inProgress: [] });
  });
});
