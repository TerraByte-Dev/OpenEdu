import { describe, it, expect } from "vitest";
import {
  ROUND_SIZE, MASTERY_STREAK, STARS_PER_DAY, seededRandom, shuffle, choiceOrder, buildRound, isAnswer, tap,
  skillProgress, lastItemIn, isUnlocked, currentSkill, tileStatus, starsToday, playTogetherToday, type AttemptRow,
} from "./engine";
import { SKILLS, ITEMS_BY_ID, choiceKey, packOf } from "./packs";
import type { Skill, SkillId } from "./types";

// A stored row, as SQLite would hand it back. `at` is a local Date; created_at is UTC like datetime('now').
function row(skill: SkillId, correct: boolean, firstTry = true, item = `${skill}/x`, at = new Date(2026, 10, 11, 10)): AttemptRow {
  return {
    skill_id: skill, item_id: item, correct: correct ? 1 : 0, first_try: firstTry ? 1 : 0,
    created_at: at.toISOString().slice(0, 19).replace("T", " "),
  };
}
const rightFirst = (skill: SkillId, n: number) => Array.from({ length: n }, () => row(skill, true));

describe("seeded choices", () => {
  it("shuffles the same way for the same seed and keeps every element", () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(list, seededRandom(42))).toEqual(shuffle(list, seededRandom(42)));
    expect([...shuffle(list, seededRandom(42))].sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("orders an item's choices the same for one attempt seed, and not always with the answer in one place", () => {
    const item = ITEMS_BY_ID.get("count-1-10/how-many-4")!;
    expect(choiceOrder(item, 7)).toEqual(choiceOrder(item, 7));
    expect(choiceOrder(item, 7).map(choiceKey).sort()).toEqual(item.choices.map(choiceKey).sort());
    const positions = new Set<number>();
    for (let seed = 0; seed < 50; seed++) positions.add(choiceOrder(item, seed).findIndex((c) => isAnswer(item, c)));
    expect(positions.size).toBe(item.choices.length);
  });
});

describe("rounds", () => {
  it("gives ROUND_SIZE different items of the skill, the same for the same seed", () => {
    for (const skill of Object.values(SKILLS)) {
      for (let seed = 0; seed < 30; seed++) {
        const round = buildRound(skill, null, seed);
        expect(round).toHaveLength(ROUND_SIZE);
        expect(new Set(round.map((i) => i.id)).size).toBe(ROUND_SIZE);
        for (const i of round) expect(i.skillId).toBe(skill.id);
        expect(buildRound(skill, null, seed)).toEqual(round);
      }
    }
  });

  it("never opens on the item the learner just saw", () => {
    for (const skill of Object.values(SKILLS)) {
      for (const last of skill.items) {
        for (let seed = 0; seed < 20; seed++) expect(buildRound(skill, last.id, seed)[0].id).not.toBe(last.id);
      }
    }
  });

  it("never repeats an item back to back, even in a skill smaller than a round", () => {
    const tiny: Skill = { ...SKILLS.shapes, items: SKILLS.shapes.items.slice(0, 2) };
    for (let seed = 0; seed < 20; seed++) {
      const round = buildRound(tiny, tiny.items[0].id, seed, 7);
      expect(round).toHaveLength(7);
      expect(round[0].id).not.toBe(tiny.items[0].id);
      for (let i = 1; i < round.length; i++) expect(round[i].id).not.toBe(round[i - 1].id);
    }
    const one: Skill = { ...SKILLS.shapes, items: SKILLS.shapes.items.slice(0, 1) };
    expect(buildRound(one, one.items[0].id, 1, 3)).toHaveLength(3);
  });
});

describe("a tap", () => {
  const item = ITEMS_BY_ID.get("count-1-10/how-many-4")!;
  const four = item.choices.find((c) => choiceKey(c) === "n:4")!;
  const five = item.choices.find((c) => choiceKey(c) === "n:5")!;

  it("praises a right answer and stores it", () => {
    const r = tap(item, four, true);
    expect(r.attempt).toEqual({ skillId: "count-1-10", itemId: item.id, correct: true, firstTry: true, choice: "n:4" });
    expect(r.feedback).toEqual({ kind: "praise", say: "Yes! 4 apples." });
  });

  it("teaches on a wrong answer (count together) and stores it as a wrong first try, with what was tapped", () => {
    const r = tap(item, five, true);
    expect(r.attempt.correct).toBe(false);
    expect(r.attempt.firstTry).toBe(true);
    expect(r.attempt.choice).toBe("n:5");
    expect(r.feedback).toEqual({ kind: "teach", say: "Let's count them together: 1, 2, 3, 4.", countAlong: true, example: null });
  });

  it("stores the taps after a retry as not first try", () => {
    expect(tap(item, four, false).attempt).toMatchObject({ correct: true, firstTry: false });
  });

  it("shows the example for a color or a shape", () => {
    const red = ITEMS_BY_ID.get("colors/red")!;
    const notRed = red.choices.find((c) => !isAnswer(red, c))!;
    expect(tap(red, notRed, true).feedback).toMatchObject({ kind: "teach", example: { kind: "color", color: "red" } });
  });
});

describe("mastery from stored attempts", () => {
  it("masters a skill at MASTERY_STREAK first-try correct answers in a row", () => {
    expect(MASTERY_STREAK).toBe(5);
    expect(skillProgress(rightFirst("colors", 4)).colors).toEqual({ mastered: false, streak: 4, attempts: 4 });
    expect(skillProgress(rightFirst("colors", 5)).colors.mastered).toBe(true);
  });

  it("resets the streak on a wrong first try", () => {
    const rows = [...rightFirst("colors", 4), row("colors", false), ...rightFirst("colors", 4)];
    expect(skillProgress(rows).colors).toMatchObject({ mastered: false, streak: 4 });
  });

  it("does not count the taps after a teaching retry, either way", () => {
    const rows = [
      ...rightFirst("colors", 2),
      row("colors", false, false), row("colors", true, false), // retries on a later item
      ...rightFirst("colors", 2),
    ];
    expect(skillProgress(rows).colors).toMatchObject({ mastered: false, streak: 4, attempts: 6 });
    expect(skillProgress([...rows, row("colors", true)]).colors.mastered).toBe(true);
  });

  it("keeps a skill mastered after later mistakes", () => {
    const rows = [...rightFirst("shapes", 5), row("shapes", false)];
    expect(skillProgress(rows).shapes).toMatchObject({ mastered: true, streak: 0 });
  });

  it("keeps each skill's streak separate", () => {
    const rows = [...rightFirst("colors", 3), row("shapes", false), ...rightFirst("colors", 2)];
    const p = skillProgress(rows);
    expect(p.colors.mastered).toBe(true);
    expect(p.shapes).toMatchObject({ mastered: false, streak: 0, attempts: 1 });
  });

  it("ignores rows for skills this build does not know", () => {
    const p = skillProgress([{ ...row("colors", true), skill_id: "letters" }]);
    expect(p.colors.attempts).toBe(0);
  });

  it("finds the last item seen in a skill", () => {
    const rows = [row("colors", true, true, "colors/red"), row("shapes", true, true, "shapes/star"), row("colors", false, true, "colors/blue")];
    expect(lastItemIn(rows, "colors")).toBe("colors/blue");
    expect(lastItemIn(rows, "count-1-10")).toBeNull();
  });
});

describe("unlock order", () => {
  it("opens counting to 20 only after counting to 10 is mastered", () => {
    const none = skillProgress([]);
    expect(isUnlocked("count-1-10", none)).toBe(true);
    expect(isUnlocked("count-11-20", none)).toBe(false);
    expect(currentSkill(packOf("counting"), none)).toBe("count-1-10");

    const done10 = skillProgress(rightFirst("count-1-10", 5));
    expect(isUnlocked("count-11-20", done10)).toBe(true);
    expect(currentSkill(packOf("counting"), done10)).toBe("count-11-20");
  });

  it("opens the first skill of every pack from the start", () => {
    const none = skillProgress([]);
    for (const id of ["colors", "count-1-10", "shapes"] as SkillId[]) expect(isUnlocked(id, none)).toBe(true);
  });

  it("keeps playing the last skill once a pack is all mastered", () => {
    const all = skillProgress([...rightFirst("count-1-10", 5), ...rightFirst("count-11-20", 5)]);
    expect(currentSkill(packOf("counting"), all)).toBe("count-11-20");
  });
});

describe("the home screen", () => {
  it("says new, how many more, or done on each tile", () => {
    expect(tileStatus(packOf("colors"), skillProgress([]))).toEqual({ kind: "new" });
    expect(tileStatus(packOf("colors"), skillProgress(rightFirst("colors", 2)))).toEqual({ kind: "going", left: 3 });
    expect(tileStatus(packOf("colors"), skillProgress([row("colors", false)]))).toEqual({ kind: "going", left: 5 });
    expect(tileStatus(packOf("colors"), skillProgress(rightFirst("colors", 5)))).toEqual({ kind: "done" });
    // Counting to 10 mastered: the tile moves on to counting to 20, which is new.
    expect(tileStatus(packOf("counting"), skillProgress(rightFirst("count-1-10", 5)))).toEqual({ kind: "new" });
  });

  it("counts today's first-try right answers as stars, up to five", () => {
    const now = new Date(2026, 10, 11, 18);
    const yesterday = new Date(2026, 10, 10, 18);
    const rows = [
      row("colors", true, true, "colors/red", yesterday),
      row("colors", true),
      row("colors", false),
      row("colors", true, false), // a retry
      row("shapes", true),
    ];
    expect(starsToday(rows, now)).toBe(2);
    expect(starsToday(rightFirst("colors", 9), now)).toBe(STARS_PER_DAY);
    expect(starsToday([], now)).toBe(0);
  });

  it("reads created_at as UTC, so a late-evening answer still counts for the local day", () => {
    const evening = new Date(2026, 10, 11, 23, 30);
    expect(starsToday([row("colors", true, true, "colors/red", evening)], new Date(2026, 10, 11, 23, 45))).toBe(1);
  });

  it("picks one play-together idea a day, from the skills being learned", () => {
    const p = skillProgress([]);
    const a = playTogetherToday(p, new Date(2026, 10, 11, 9));
    expect(playTogetherToday(p, new Date(2026, 10, 11, 20))).toBe(a);
    const current = [...SKILLS.colors.playTogether, ...SKILLS["count-1-10"].playTogether, ...SKILLS.shapes.playTogether];
    expect(current).toContain(a);
    expect(SKILLS["count-11-20"].playTogether).not.toContain(a);
  });
});
