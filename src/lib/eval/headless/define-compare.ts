// Compare the define suite's two arms, offline (no model, no Ollama): docs/BENCHMARKS.md lever 18.
//
//   $env:DEFINE_B = "<main>/.dev/eval-runs/...-define-test-B-gemma4_e2b.json"
//   $env:DEFINE_D = "<main>/.dev/eval-runs/...-define-test-D-gemma4_e2b.json"
//   npx vite-node src/lib/eval/headless/define-compare.ts
//
// Prints, per pre-registered group, item-majority passes in each arm with a 95% Wilson interval, the
// items lost and gained, and the exact McNemar p (define-grade.ts compareDefineArms); the same with every
// item that has an ERROR row in either arm dropped; per-arm ERROR, detected and noted counts over
// non-ERROR rows, with the ids that missed; added model calls; median reply length per band
// (descriptive: the grader does not score reading level); and the lever 18 clauses read as written
// (judgeDefine). Refuses two files from different commits, models, splits or options, or the same arm
// twice; on the test split it also refuses a partial or void run, unequal repeats or repeats other than
// 3, and a group smaller than the frozen test split. DEFINE_OUT writes to a file.

import { DEFINE_ITEMS, DEFINE_SPLIT } from "../define-items";
import { compareDefineArms, judgeDefine, addedCalls, type ArmContrast } from "../define-grade";
import { compareRefusals, shortGroups, type Saved } from "./define-script-lib";
import { env, fs, writeText } from "./node-io";

const pct = (k: number, n: number, w: [number, number]) => `${k}/${n} (${(100 * w[0]).toFixed(1)}–${(100 * w[1]).toFixed(1)}%)`;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);

async function main(): Promise<void> {
  const e = env();
  const f = await fs();
  const load = async (k: string): Promise<Saved> => {
    const file = e[k];
    if (!file) throw new Error(`Set ${k} to a define results file.`);
    return JSON.parse(await f.readFile(file, "utf8")) as Saved;
  };
  const [b, d] = [await load("DEFINE_B"), await load("DEFINE_D")];
  const why = compareRefusals(b, d);
  if (why.length) throw new Error(`Refusing to compare: ${why.join("; ")}.`);

  const errorItems = new Set([...b.rows, ...d.rows].filter((r) => r.error).map((r) => r.id));
  const all = compareDefineArms(DEFINE_ITEMS, b.split, DEFINE_SPLIT, b.rows, d.rows);
  const withoutErrorItems = compareDefineArms(DEFINE_ITEMS, b.split, DEFINE_SPLIT, b.rows, d.rows, { dropItems: errorItems });
  if (b.split === "test") {
    const short = shortGroups(all);
    if (short.length) throw new Error(`Refusing to compare: items missing from an arm (${short.join("; ")}).`);
  }

  const out: string[] = [];
  out.push(`define ${b.split}, ${b.model}, commit ${b.commit?.slice(0, 7)}, repeats ${b.repeats}${b.partial || d.partial ? ", PARTIAL (not a result)" : ""}${b.void || d.void ? ", VOID" : ""}`, "");
  const wordOf = new Map(DEFINE_ITEMS.map((i) => [i.id, i.word]));
  for (const [name, s] of [["B", b], ["D", d]] as const) {
    const ok = s.rows.filter((r) => !r.error);
    const missedWord = ok.filter((r) => r.askedWord?.toLowerCase() !== wordOf.get(r.id)).map((r) => `${r.id}#${r.repeat}`);
    const noted = ok.filter((r) => r.dictionaryNote).length;
    const unnoted = name === "D" ? ok.filter((r) => !r.dictionaryNote).map((r) => `${r.id}#${r.repeat}`) : [];
    const added = s.rows.reduce((k, r) => k + addedCalls(r).added, 0);
    const retried = ok.filter((r) => r.attempts > 1).length;
    const tools = ok.reduce((k, r) => k + r.toolCalls.length, 0);
    out.push(`${name}: rows ${s.rows.length}, ERROR ${s.rows.length - ok.length}${s.rows.length - ok.length ? ` (${s.rows.filter((r) => r.error).map((r) => `${r.id}#${r.repeat}`).join(", ")})` : ""}; detected ${ok.length - missedWord.length}/${ok.length}${missedWord.length ? ` (missed ${missedWord.join(", ")})` : ""}; noted ${noted}/${ok.length}${unnoted.length ? ` (no note: ${unnoted.join(", ")})` : ""}; added calls ${added}; retried rows ${retried}; tool calls ${tools}`);
  }
  out.push("");
  const table = (title: string, list: readonly ArmContrast[]) => {
    out.push(`### ${title}`, "", "| Group | n | B | D | lost | gained | McNemar p |", "|---|---|---|---|---|---|---|");
    for (const c of list) out.push(`| ${c.group} | ${c.n} | ${pct(c.b.k, c.n, c.b.wilson)} | ${pct(c.d.k, c.n, c.d.wilson)} | ${c.lost.join(", ") || "—"} | ${c.gained.join(", ") || "—"} | ${c.p.toFixed(4)} |`);
    out.push("");
  };
  table("All items (item-majority)", all);
  table(`Without items that have an ERROR row in either arm (${errorItems.size} dropped)`, withoutErrorItems);

  out.push("### Median reply length in words, by band (descriptive; reading level is not gated)", "", "| Band | B | D |", "|---|---|---|");
  for (const band of ["K-2", "3-5", "6-8", "9-12"] as const) {
    const words = (s: Saved) => median(s.rows.filter((r) => !r.error && r.band === band).map((r) => r.reply.split(/\s+/).filter(Boolean).length));
    out.push(`| ${band} | ${words(b) ?? "—"} | ${words(d) ?? "—"} |`);
  }
  out.push("");

  if (b.split === "test") {
    const v = judgeDefine({ all, withoutErrorItems, rowsB: b.rows, rowsD: d.rows, wordOf });
    out.push("### Lever 18 clauses, as written (lexical; a harm clause that fires goes to blind adjudication of its lost and gained items first)", "");
    for (const c of v.clauses) out.push(`- ${c.fires ? "FIRES" : "holds"}: ${c.clause} (${c.detail})`);
    const accuracy = v.accuracy === "lever" ? "an accuracy lever (both readings, with and without ERROR items)"
      : v.accuracy === "ceiling" ? "untestable at this n (ceiling: B passes 40 or more of 45 target items)"
      : "not shown (report as a trust/UX feature)";
    // A firing kill clause decides the outcome; an accuracy reading beside it would read as a claim.
    out.push("", v.killed
      ? "Lexical outcome: a kill clause fires. No accuracy reading is printed; adjudicate the harm clause (if that is what fired) before reading the outcome."
      : `Lexical outcome: no kill clause fires; accuracy: ${accuracy}.`);
    out.push("Reminder: if the B8 validation gate missed (kappa below 0.8 on either reading, or no grader-1 export by the wording-freeze commit), B8 is descriptive and no accuracy claim is made, whatever this says.");
    out.push("The other-models clause and the void rule are read across files; this compares one model.");
  }
  const text = out.join("\n");
  if (e.DEFINE_OUT) await writeText(e.DEFINE_OUT, text);
  else console.log(text);
}

await main();
