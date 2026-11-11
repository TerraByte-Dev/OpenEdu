// The early-learner (K-1) activity engine's types (#244). Pure: no DOM, no Tauri. A skill is an ordered
// set of items; an item is a spoken prompt, a picture spec and 2-4 tap choices with an answer key that
// is data. There is no model call anywhere in src/lib/early/.

export type PackId = "colors" | "counting" | "shapes";
export type SkillId = "colors" | "count-1-10" | "count-11-20" | "shapes";

export type ColorId = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "brown";
export type ShapeId = "circle" | "square" | "triangle" | "rectangle" | "star" | "heart";

/** What the picture card shows above the choices. The UI draws each one as inline SVG. */
export type Picture =
  | { kind: "apples"; count: number }
  | { kind: "dots"; n: number }        // the example for a "find N dots" retry: dots, like its choices
  | { kind: "numeral"; n: number }
  | { kind: "color"; color: ColorId }
  | { kind: "shape"; shape: ShapeId }
  | { kind: "none" };

/** One tap target. */
export type Choice =
  | { kind: "numeral"; n: number }   // a big number (with its dots under it up to 10)
  | { kind: "dots"; n: number }      // a group of n dots, in rows of five
  | { kind: "color"; color: ColorId }
  | { kind: "shape"; shape: ShapeId };

/** What a wrong tap shows and says. It teaches; it never says "wrong". */
export interface Teaching {
  say: string;
  /** Number the apples (or dots) one by one in the picture: "count together". */
  countAlong: boolean;
  /** A picture of the right answer to look at: "show the example". */
  example: Picture | null;
}

export interface Item {
  /** Stable across releases: stored in early_attempts.item_id. */
  id: string;
  skillId: SkillId;
  /** Spoken aloud when the item appears, and shown as the heading. */
  prompt: string;
  picture: Picture;
  /** In data order. The screen shows them in choiceOrder(item, seed). */
  choices: Choice[];
  /** choiceKey() of the right choice. */
  answer: string;
  /** Said (and shown) on a right tap. */
  praise: string;
  teach: Teaching;
}

export interface Skill {
  id: SkillId;
  pack: PackId;
  /** Child-facing name, said aloud on the round-end screen. */
  name: string;
  /** The skill in the same pack that must be mastered first, or null. */
  after: SkillId | null;
  items: Item[];
  /** Footer on the activity screen. */
  grownUpTip: string;
  /** Screen-free things to do together, shown on the home screen. */
  playTogether: string[];
}

export interface Pack {
  id: PackId;
  title: string;
  /** Skills in unlock order. */
  skills: SkillId[];
}
