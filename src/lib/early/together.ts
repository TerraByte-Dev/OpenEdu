// "Try together, no screen" (#244 PR 2): hand-written things a grown-up and a K-1 child can do away from
// the screen, per skill. Static data, no model. Reviewed for a 5-7 year old, and for younger brothers and
// sisters who may be nearby: nothing small enough to swallow (no coins, beads, buttons off a shirt, dried
// beans, marbles, balloons, grapes or popcorn), no knives, cooking, stoves or ovens, and no water play.
// Anything near stairs or a road says to hold hands or the rail. together.test.ts checks the word list.

import type { SkillId } from "./types";
import type { Confusion, SkillReport } from "./report";

export interface TogetherIdea {
  title: string;
  how: string;
}

export const TRY_TOGETHER: Record<SkillId, TogetherIdea[]> = {
  "colors": [
    { title: "Color hunt", how: "Pick a color and find three things that color in the room. Take turns picking." },
    { title: "Sock sort", how: "Sort a pile of clean socks by color, and name each pile together." },
    { title: "I spy a color", how: "Play I spy with colors: \"I spy something green.\" Take turns guessing." },
  ],
  "count-1-10": [
    { title: "Count the stairs", how: "Hold hands or the rail and count each stair out loud as you climb." },
    { title: "Set the table", how: "Count out one spoon for each person, then count the spoons again together." },
    { title: "Jump and count", how: "Do up to 10 big jumps together, counting each one out loud." },
  ],
  "count-11-20": [
    { title: "Count past 10", how: "Clap and count to 20 together. Next time, start from 11." },
    { title: "Line up the books", how: "Line up 12 to 20 books or stuffed animals and count them, touching each one." },
    { title: "Steps to the door", how: "Count your steps from one room to another. Did it take more or less than 20?" },
  ],
  "shapes": [
    { title: "Shape hunt", how: "Find shapes at home: a round plate, a square tile, a rectangle door." },
    { title: "Draw in the air", how: "Draw a circle, a square and a triangle in the air with a finger and say each name." },
    { title: "Draw together", how: "Take turns drawing a star and a heart on paper. Count the star's points." },
  ],
};

/** An idea aimed at one mix-up, from a fixed template per skill. `name` is the learner's first name. */
export function mixUpIdea(c: Confusion, name: string): TogetherIdea {
  switch (c.skillId) {
    case "colors":
      return { title: `Two colors: ${c.a} and ${c.b}`, how: `${name} mixes these up. Find one ${c.a} thing and one ${c.b} thing at home and put them side by side.` };
    case "count-1-10":
    case "count-11-20":
      return { title: `Count ${c.a} and ${c.b}`, how: `${name} mixes these up. Count ${c.a} claps, then ${c.b} claps, out loud. Which was more?` };
    case "shapes":
      return { title: `A ${c.a} or a ${c.b}?`, how: `${name} mixes these up. Draw a ${c.a} and a ${c.b} side by side and count their sides or points together.` };
  }
}

/**
 * What to show: for each skill the learner is learning (in pack order), an idea for its most frequent
 * mix-up if it has one, then its hand-written ideas, up to `max` in all. Mastered and not-yet skills
 * get none.
 */
export function togetherIdeas(
  reports: ReadonlyArray<SkillReport>,
  confusions: ReadonlyArray<Confusion>,
  name: string,
  max = 4,
): Array<{ skillId: SkillId; idea: TogetherIdea }> {
  const learning = reports.filter((r) => r.status === "learning");
  const out: Array<{ skillId: SkillId; idea: TogetherIdea }> = [];
  // Round-robin, so two skills in progress both get a turn before either gets a second idea.
  const queues = learning.map((r) => {
    const c = confusions.find((x) => x.skillId === r.id);
    return [...(c ? [mixUpIdea(c, name)] : []), ...TRY_TOGETHER[r.id]].map((idea) => ({ skillId: r.id, idea }));
  });
  for (let i = 0; out.length < max && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < max) out.push(q[i]);
  }
  return out;
}
