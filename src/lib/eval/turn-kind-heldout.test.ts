import { describe, it, expect } from "vitest";
import { classifyTurn, type TurnKind } from "../kernel/turnKind";
import { TURN_KIND_HELDOUT, type TurnKindHeldoutItem, type TurnKindLabel } from "./turn-kind-heldout";

// Blind held-out check of the turn classifier (kernel/turnKind.ts). RECORDS, never asserts accuracy:
// the only expectations below are about the set's shape, so a bad score can never fail CI and a
// rule change can never be tuned to make this test pass. The numbers are printed to stdout and
// written up in results/2026-11-08-turn-kind-heldout.md.
//
// Each message is classified as the student's newest message with an empty history. The classifier's
// four kinds fold to the set's three labels: options-problem and typed-problem are "problem",
// fact-lookup is "lookup", other is "none".
//
// Severity of a confusion (the point of the check):
//   severe    problem -> lookup: the tutor is told to answer directly, so it gives the answer away.
//   severe    none that is the student's own try -> problem or lookup: a hold or a direct-answer note
//             lands on a try.
//   moderate  lookup -> problem: the tutor withholds a fact the student was owed.
//   mild      anything -> none: the status quo, no note.
//   unranked  none that is not a try -> problem or lookup: the task's scale does not cover it; listed
//             on its own so it is not hidden.

/**
 * The "none" rows that are the student's own try (an answer, a worked attempt, a self-correction, a
 * claim to check). Fixed from each row's text and `why` before the classifier was run on the set;
 * the labels themselves are untouched. n58 is also marked ambiguous by the set's author.
 */
const ATTEMPT_IDS = new Set([
  "n03", "n04", "n05", "n11", "n12", "n13", "n22", "n23", "n29", "n35",
  "n36", "n40", "n41", "n45", "n48", "n53", "n54", "n58", "n60",
  "x03", "x15",
]);

const LABELS: TurnKindLabel[] = ["problem", "lookup", "none"];

const fold = (k: TurnKind): TurnKindLabel =>
  k === "options-problem" || k === "typed-problem" ? "problem" : k === "fact-lookup" ? "lookup" : "none";

/** Wilson score interval, 95%. Null when n is 0. */
function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

type Scored = TurnKindHeldoutItem & { kind: TurnKind; got: TurnKindLabel };
type Severity = "severe" | "moderate" | "mild" | "unranked";

function severity(r: Scored): Severity | null {
  if (r.got === r.label) return null;
  if (r.got === "none") return "mild";
  if (r.label === "problem" && r.got === "lookup") return "severe";
  if (r.label === "lookup" && r.got === "problem") return "moderate";
  // label none, got problem or lookup
  return ATTEMPT_IDS.has(r.id) ? "severe" : "unranked";
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const rate = (k: number, n: number) => {
  const w = wilson(k, n);
  return w ? `${k}/${n} = ${pct(k / n)} [${pct(w[0])}, ${pct(w[1])}]` : `0/0 (undefined)`;
};

function table(title: string, rows: Scored[]): string {
  const m = (l: TurnKindLabel, g: TurnKindLabel) => rows.filter((r) => r.label === l && r.got === g).length;
  const out = [`### ${title} (n = ${rows.length})`, "", "| label \\ classified | problem | lookup | none | total |", "|---|---|---|---|---|"];
  for (const l of LABELS) out.push(`| ${l} | ${LABELS.map((g) => m(l, g)).join(" | ")} | ${rows.filter((r) => r.label === l).length} |`);
  out.push(`| total | ${LABELS.map((g) => rows.filter((r) => r.got === g).length).join(" | ")} | ${rows.length} |`, "");
  out.push("| class | precision (Wilson 95%) | recall (Wilson 95%) |", "|---|---|---|");
  for (const l of LABELS) {
    const tp = m(l, l);
    out.push(`| ${l} | ${rate(tp, rows.filter((r) => r.got === l).length)} | ${rate(tp, rows.filter((r) => r.label === l).length)} |`);
  }
  const correct = rows.filter((r) => r.got === r.label).length;
  out.push("", `Agreement: ${rate(correct, rows.length)}`, "");
  return out.join("\n");
}

function scoreAll(): Scored[] {
  return TURN_KIND_HELDOUT.map((it) => {
    const kind = classifyTurn([{ role: "user", content: it.text }]);
    return { ...it, kind, got: fold(kind) };
  });
}

describe("turn classifier on the blind held-out set (records only)", () => {
  it("the set has the shape it was frozen with", () => {
    expect(TURN_KIND_HELDOUT).toHaveLength(200);
    expect(new Set(TURN_KIND_HELDOUT.map((r) => r.id)).size).toBe(200);
    // the attempt annotation only names rows labelled none
    const byId = new Map(TURN_KIND_HELDOUT.map((r) => [r.id, r]));
    for (const id of ATTEMPT_IDS) expect(byId.get(id)?.label).toBe("none");
  });

  it("prints the confusion matrices, misclassified rows and graded confusions", () => {
    const all = scoreAll();
    const groups: Array<[string, Scored[]]> = [
      ["English, not ambiguous", all.filter((r) => r.lang === "en" && !r.ambiguous)],
      ["English, ambiguous", all.filter((r) => r.lang === "en" && r.ambiguous)],
      ["Non-English", all.filter((r) => r.lang !== "en")],
    ];
    const lines: string[] = ["", "=== TURN-KIND HELD-OUT RESULTS ===", ""];
    for (const [title, rows] of groups) lines.push(table(title, rows));

    // English hard cases only (not ambiguous), recall by class, for a hard/easy split
    const enNa = groups[0][1];
    lines.push("### English not ambiguous, recall by hard flag", "", "| class | hard | not hard |", "|---|---|---|");
    for (const l of LABELS) {
      const h = enNa.filter((r) => r.label === l && r.hard), e = enNa.filter((r) => r.label === l && !r.hard);
      lines.push(`| ${l} | ${rate(h.filter((r) => r.got === l).length, h.length)} | ${rate(e.filter((r) => r.got === l).length, e.length)} |`);
    }
    lines.push("");

    lines.push("### Severity counts", "", "| group | severe: problem->lookup | severe: try->problem/lookup | moderate: lookup->problem | mild: ->none | unranked: non-try none->problem/lookup |", "|---|---|---|---|---|---|");
    for (const [title, rows] of groups) {
      const c = (f: (r: Scored) => boolean) => rows.filter(f).length;
      lines.push(`| ${title} | ${c((r) => r.label === "problem" && r.got === "lookup")} | ${c((r) => r.label === "none" && r.got !== "none" && ATTEMPT_IDS.has(r.id))} | ${c((r) => severity(r) === "moderate")} | ${c((r) => severity(r) === "mild")} | ${c((r) => severity(r) === "unranked")} |`);
    }
    lines.push("");

    lines.push("### Every misclassified message", "", "| id | group | label | classified (raw kind) | severity | hard | text |", "|---|---|---|---|---|---|---|");
    const order: Record<Severity, number> = { severe: 0, moderate: 1, unranked: 2, mild: 3 };
    const wrong = all.filter((r) => r.got !== r.label).sort((a, b) => order[severity(a)!] - order[severity(b)!] || a.id.localeCompare(b.id));
    for (const r of wrong) {
      const g = r.lang !== "en" ? `non-en (${r.lang})` : r.ambiguous ? "en, ambiguous" : "en";
      lines.push(`| ${r.id} | ${g} | ${r.label} | ${r.got} (${r.kind}) | ${severity(r)} | ${r.hard ? "yes" : "no"} | ${JSON.stringify(r.text).replace(/\|/g, "\\|")} |`);
    }
    lines.push("", "=== END ===", "");
    console.log(lines.join("\n"));
  });
});
