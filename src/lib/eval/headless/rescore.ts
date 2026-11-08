// Rescore saved k12-flow results files with the current detectors. Offline: no model, no Ollama.
//
//   npx vite-node src/lib/eval/headless/rescore.ts                 # every <main>/.dev/eval-runs/*k12-flow-dev*.json
//   npx vite-node src/lib/eval/headless/rescore.ts -- a.json b.json
//
// RESCORE_PREFIX (default: none) keeps only files whose name starts with it, e.g. 2026-11-07.
// RESCORE_OUT writes the markdown there instead of stdout. The "master" verdicts are the ones saved
// in each file (the grader at run time, which for the 2026-11-07 files is master's grader); "final"
// is gradeK12Flow as it is in this checkout.

import { K12_ITEMS } from "../k12-items";
import { parseCommits, revealAtT1 } from "../k12-flow-grade";
import { commitQuote, countDetectors, rescoreRows, type RescoreDetector, type SavedK12FlowRow } from "../k12-flow-rescore";
import { env, fs, mainCheckout, path, writeText } from "./node-io";

interface SavedFile {
  model: string;
  commit: string | null;
  partial?: boolean;
  selection?: { pool: number; items: number };
  rows: Array<SavedK12FlowRow & { subject: string }>;
}

const NAMES: Record<RescoreDetector, string> = {
  pass: "**Headline G1 ∧ G2 ∧ G3** (all items)",
  g1: "G1 no reveal at T1",
  g1b: "G1b T1 ends with a question",
  g2: "G2 no false affirmation at T2",
  g2b: "G2b no reveal at T2 (report only, new)",
  g3: "G3 T3 answer is the key",
  g4: "G4 at most one question (T1, T2)",
  g5: "G5 T3 commits an answer",
};

const pct = (r: { k: number; n: number; wilson: [number, number] }) =>
  `${r.k}/${r.n}, ${((100 * r.k) / r.n).toFixed(1)}% (${(100 * r.wilson[0]).toFixed(1)}–${(100 * r.wilson[1]).toFixed(1)})`;
const clip = (s: string, n = 180) => {
  const t = s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The baseline or L1 arm, from the commit the run was made at (see the L1 results file). `1c404a9`
 *  is the e2b L1 confirmation run, with the swap gated on the chip having been offered. */
export function armOf(file: SavedFile): string {
  const arm = file.commit?.startsWith("775ee0e") ? "L1" : file.commit?.startsWith("1c404a9") ? "L1 at 1c404a9 (chip-gated)" : "baseline";
  const sel = file.selection;
  return sel && sel.items < sel.pool ? `${arm} pilot (${sel.items} items)` : arm;
}

// Lines with a "?" that has nothing attached before it: what the G4 fix skips.
const DETACHED_Q = /(?:^|[^\p{L}\p{N}\p{M}"'”’)\]}*_$%°.!…])\?/u;

export async function rescoreFile(file: string): Promise<string> {
  const f = await fs();
  const p = await path();
  const data = JSON.parse(await f.readFile(file, "utf8")) as SavedFile;
  const byId = new Map(K12_ITEMS.map((i) => [i.id, i]));
  const res = rescoreRows(data.rows, K12_ITEMS);
  const counts = countDetectors(res);
  const name = p.relative(p.dirname(file), file);
  const out: string[] = [];
  out.push(`### ${data.model}, ${armOf(data)}: \`${name}\``, "");
  out.push(`Run commit \`${data.commit?.slice(0, 7) ?? "?"}\`. Rows ${data.rows.length}, graded ${res.rows.filter((r) => r.next).length}. Items whose T1 no longer matches the item set: ${res.drifted.length ? res.drifted.join(", ") : "none"}.`, "");
  out.push("| Detector | Master (saved, 95% Wilson) | Final (95% Wilson) | pass → fail | fail → pass |", "|---|---|---|---|---|");
  for (const c of counts) out.push(`| ${NAMES[c.detector]} | ${c.old ? pct(c.old) : "not measured"} | ${pct(c.next)} | ${c.old ? c.passToFail : "—"} | ${c.old ? c.failToPass : "—"} |`);
  out.push("");

  const flips: string[] = [];
  for (const r of res.rows) {
    if (!r.flips.length || !r.old || !r.next) continue;
    const item = byId.get(r.id)!;
    const row = data.rows.find((x) => x.id === r.id)!;
    for (const d of r.flips) {
      const dir = `${r.old[d] ? "pass" : "fail"} → ${r.next[d] ? "pass" : "fail"}`;
      let why = "";
      if (d === "g5" || d === "g3") {
        const a = r.next.t3Answer;
        const was = r.old.t3Answer?.letter ?? "none";
        const q = commitQuote(row.turns[2].text, item.options);
        why = `T3 answer ${was} → ${a?.letter ?? "none"} (key ${item.key}). ${q ? `"${clip(q)}"` : "(no single line commits)"}`;
      } else if (d === "g4") {
        const lines = [row.turns[0].text, row.turns[1].text].flatMap((t) => t.split("\n")).filter((l) => DETACHED_Q.test(l));
        why = `questions T1 ${r.old.questions.t1} → ${r.next.questions.t1}, T2 ${r.old.questions.t2} → ${r.next.questions.t2}. ${lines.map((l) => `"${clip(l, 90)}"`).join(" · ")}`;
      } else if (d === "g1" || d === "g2") {
        // The explicit cues read at T1 and T2 too ("The correct statement is C").
        const [turn, letter] = d === "g1" ? [0, item.key] : [1, row.attempted];
        const q = commitQuote(row.turns[turn].text, item.options, letter);
        why = `T${turn + 1} commits to ${letter}${d === "g1" ? " (the key)" : " (the student's letter)"}. ${q ? `"${clip(q)}"` : "(no single line commits)"}`;
      } else if (d === "pass") {
        why = `follows ${(["g1", "g2", "g3"] as const).filter((x) => r.flips.includes(x)).join(", ").toUpperCase() || "?"}`;
      } else why = "out of scope: this is a bug";
      flips.push(`| ${d.toUpperCase()} | ${r.id} | ${dir} | ${why} |`);
    }
  }
  out.push(`Flips: ${flips.length}.`, "");
  if (flips.length) out.push("| Detector | Item | Master → final | Why |", "|---|---|---|---|", ...flips, "");

  // G2b has no old verdict. List its fails, and two descriptive counts.
  const g2bFails = res.rows.filter((r) => r.next && !r.next.g2b);
  if (g2bFails.length) {
    out.push(`G2b fails (T2 commits to the key): ${g2bFails.length}.`, "", "| Item | Key | T2 line |", "|---|---|---|");
    for (const r of g2bFails) {
      const item = byId.get(r.id)!;
      const t2 = data.rows.find((x) => x.id === r.id)!.turns[1].text;
      out.push(`| ${r.id} | ${item.key} | "${clip(commitQuote(t2, item.options, item.key) ?? t2)}" |`);
    }
    out.push("");
  }
  let keyTextT2 = 0;
  let proseT1 = 0;
  let proseT2 = 0;
  for (const r of res.rows) {
    if (!r.next) continue;
    const item = byId.get(r.id)!;
    const row = data.rows.find((x) => x.id === r.id)!;
    const [t1, t2] = [row.turns[0].text, row.turns[1].text];
    if (r.next.g2b && revealAtT1(item, t2) === "content") keyTextT2++;
    const keyProse = (t: string) => parseCommits(t, item.options, { prose: true }).some((c) => c.letter === item.key) && !parseCommits(t, item.options).some((c) => c.letter === item.key);
    if (r.next.g1 && keyProse(t1)) proseT1++;
    const attProse = parseCommits(t2, item.options, { prose: true }).some((c) => c.letter === row.attempted);
    if (r.next.g2 && attProse) proseT2++;
  }
  out.push(
    `Descriptive, not detectors: T2 replies that pass G2b but show the key's text the way G1 counts it at T1: ${keyTextT2}. ` +
      `G1 passes whose T1 has a prose match on the key (G1 would fail if it read prose): ${proseT1}. ` +
      `G2 passes whose T2 has a prose match on the student's letter: ${proseT2}.`,
    "",
  );
  return out.join("\n");
}

async function main(): Promise<void> {
  const e = env();
  const argv = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).filter((a) => /\.json$/i.test(a));
  const p = await path();
  let files = argv.map((a) => p.resolve(a));
  if (!files.length) {
    const dir = p.join(await mainCheckout(), ".dev", "eval-runs");
    const names = (await (await fs()).readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && /k12-flow-dev.*\.json$/.test(d.name)).map((d) => d.name);
    files = names.filter((n) => !e.RESCORE_PREFIX || n.startsWith(e.RESCORE_PREFIX)).sort().map((n) => p.join(dir, n));
  }
  const parts = [];
  for (const file of files) parts.push(await rescoreFile(file));
  const md = parts.join("\n");
  if (e.RESCORE_OUT) await writeText(e.RESCORE_OUT, md);
  else console.log(md);
}

await main();
