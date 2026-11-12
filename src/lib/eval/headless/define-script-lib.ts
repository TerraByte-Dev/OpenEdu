// Helpers for the define suite's offline scripts (define-compare.ts, define-label-sheet.ts,
// define-label-grader2.ts). They live here, in a module with no entry point, so tests can import them
// and each script can end with an unconditional `await main()`: vite-node rewrites process.argv, so a
// script cannot tell from argv that it was run directly (lever 18 review round 2, B2).

import { DEFINE_TEST_GROUP_N, type ArmContrast, type DefineRunRow } from "../define-grade";
import { DEFINE_LABEL_QUESTIONS, SENSE_CLAUSE, questionText } from "../define-label";
import type { DefineKind, DefineSplit } from "../define-items";
import type { GradeBand } from "../../grade";
import { lastCommitOf } from "./node-io";

/** The lexical grader's commits (define-grade.ts and define-items.ts), as a label sheet's id and
 *  define-kappa.ts name them. Throws if either file has local changes. */
export const graderCommits = async (): Promise<string> =>
  `${await lastCommitOf("src/lib/eval/define-grade.ts")}+${await lastCommitOf("src/lib/eval/define-items.ts")}`;

// ── define-compare.ts ────────────────────────────────────────────────────────

/** A define results file, as headless/run.ts writes it. */
export interface Saved {
  suite: string;
  commit: string | null;
  model: string;
  split: DefineSplit;
  dictionary: "on" | "off";
  /** Absent in files written before lever 19 (they ran with stored order). */
  senseRank?: "on" | "off";
  repeats: number;
  partial: boolean;
  void?: boolean;
  only?: string | null;
  options?: Record<string, unknown>;
  rows: Array<DefineRunRow & { band: GradeBand }>;
}

/** Why two files cannot be compared, or [] when they can. Pure, so the refusals are testable. */
export function compareRefusals(b: Saved, d: Saved): string[] {
  const why: string[] = [];
  if (b.suite !== "define" || d.suite !== "define") why.push("not define results files");
  // Lever 18: B (no note) against D (the note). Lever 19 on B8 (dev, in-sample): S (EVAL_SENSE_RANK=off)
  // as DEFINE_B against R (the ranker) as DEFINE_D, both with the note.
  const lever19 = b.dictionary === "on" && d.dictionary === "on" && b.senseRank === "off" && d.senseRank === "on";
  if (!lever19 && (b.dictionary !== "off" || d.dictionary !== "on")) why.push("DEFINE_B must be the EVAL_DICTIONARY=off arm and DEFINE_D the note arm (or, for lever 19, DEFINE_B the EVAL_SENSE_RANK=off arm and DEFINE_D the ranked arm)");
  if (!b.commit || !d.commit) why.push("a file has no commit");
  else if (b.commit !== d.commit) why.push(`different commits (${b.commit} vs ${d.commit})`);
  if (b.model !== d.model) why.push(`different models (${b.model} vs ${d.model})`);
  if (b.split !== d.split) why.push(`different splits (${b.split} vs ${d.split})`);
  // Everything but the arm switch, the output path and the timestamps must match.
  const opts = (s: Saved) => JSON.stringify({ ...s.options, dictionary: undefined, senseRank: undefined, out: undefined });
  if (b.options && d.options && opts(b) !== opts(d)) why.push("different run options");
  if (b.split === "test") {
    if (b.partial || d.partial || b.only || d.only) why.push("a partial run on the test split is not a result");
    if (b.void || d.void) why.push("a void run: rerun both arms once at the same commit (lever 18 void rule)");
    if (b.repeats !== d.repeats) why.push(`unequal repeats (${b.repeats} vs ${d.repeats})`);
    else if (b.repeats !== 3) why.push(`the test split runs 3 repeats, not ${b.repeats}`);
  }
  // The rows, not the header, say how many repeats ran: every item needs exactly `repeats` rows.
  for (const [name, s] of [["B", b], ["D", d]] as const) {
    const per = new Map<string, number>();
    for (const r of s.rows) per.set(r.id, (per.get(r.id) ?? 0) + 1);
    const off = [...per].filter(([, n]) => n !== s.repeats).map(([id, n]) => `${id} (${n})`);
    if (off.length) why.push(`${name} has items whose row count is not its ${s.repeats} repeats: ${off.slice(0, 5).join(", ")}${off.length > 5 ? ", ..." : ""}`);
  }
  return why;
}

/** Test-split groups smaller than the frozen split (an item missing from one arm drops it). */
export function shortGroups(contrasts: readonly ArmContrast[]): string[] {
  return contrasts.filter((c) => c.n < DEFINE_TEST_GROUP_N[c.group]).map((c) => `${c.group} n ${c.n} < ${DEFINE_TEST_GROUP_N[c.group]}`);
}

// ── define-label-sheet.ts ────────────────────────────────────────────────────

export interface SheetRow { rid: string; word: string; kind: "plain" | "sense"; ask: string; reply: string }

/** The sheet: one HTML file, no network, answers in localStorage, export to JSON (the k12 sheet's
 *  export shape, so define-kappa.ts reads both graders' files the same way). */
export function renderDefineSheet(sheetId: string, rows: SheetRow[]): string {
  const data = JSON.stringify({ sheet: sheetId, questions: DEFINE_LABEL_QUESTIONS, senseClause: SENSE_CLAUSE, rows }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Word meaning labels</title>
<style>
:root { --bg: #f7f7f5; --card: #fff; --ink: #1d1d1f; --muted: #5f6368; --rule: #dadce0; --accent: #0b6bcb; --reply: #f1f3f4; --done: #e6f4ea; --no: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #141518; --card: #1d1f23; --ink: #e8eaed; --muted: #a0a4ab; --rule: #3a3d42; --accent: #6ab0ff; --reply: #26292e; --done: #1f3326; --no: #f28b82; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 16px; }
.card { background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 16px; margin: 12px 0; }
.muted { color: var(--muted); } .warn { color: var(--no); }
.reply { background: var(--reply); border-radius: 8px; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.strip { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.strip button { width: 44px; font-size: .8rem; padding: 2px 0; } .strip button.done { background: var(--done); } .strip button.here { outline: 2px solid var(--accent); }
button, input[type=text], textarea { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 12px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.q { border-top: 1px solid var(--rule); padding: 10px 0; } .q label { margin-right: 18px; cursor: pointer; }
textarea { width: 100%; min-height: 56px; }
</style>
</head>
<body>
<main>
<h1>Word meaning labels</h1>
<div class="card">
  <p>Each row is a student's question about what a word means, and one tutor reply. Answer the yes/no questions about
  the reply as written. Judge the meaning, not the style: a reply can be long, short, simple or formal. Markdown is not
  rendered (<code>**word**</code> is bold).</p>
  <p>Do not look at the define results files, the expect terms in the code, or any verdicts file before you export. Do not
  discuss rows with the other grader until both have exported.</p>
  <div class="bar"><label>Your name <input type="text" id="grader" autocomplete="off"></label>
  <button class="primary" id="export">Export answers</button>
  <label class="muted">Load answers <input type="file" id="load" accept=".json,application/json"></label></div>
  <p id="status" class="muted"></p><div class="strip" id="strip"></div>
</div>
<div id="row"></div>
<div class="bar"><button id="prev">Previous</button><button id="next">Next</button><button id="nextOpen">Next unanswered</button></div>
</main>
<script type="application/json" id="data">${data}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  var KEY = "define-label:" + D.sheet;
  var st = { grader: "", answers: {}, at: 0 };
  try { var s = localStorage.getItem(KEY); if (s) st = Object.assign(st, JSON.parse(s)); } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { status("Could not save here: export often.", true); } }
  function el(t, a, x) { var n = document.createElement(t); if (a) for (var k in a) n.setAttribute(k, a[k]); if (x != null) n.textContent = x; return n; }
  function qs(r) { return D.questions.filter(function (q) { return q.kinds.indexOf(r.kind) >= 0; }); }
  function text(q, r) { return q.text.split("{word}").join(r.word).split("{sense}").join(r.kind === "sense" ? D.senseClause : ""); }
  function done(r) { var a = st.answers[r.rid] || {}; return qs(r).every(function (q) { return a[q.id] === "yes" || a[q.id] === "no"; }); }
  function status(m, bad) { var s = document.getElementById("status"); s.textContent = m; s.className = bad ? "warn" : "muted"; }
  function strip() {
    var s = document.getElementById("strip"); s.textContent = "";
    D.rows.forEach(function (r, i) { var b = el("button", { type: "button" }, r.rid); b.className = (done(r) ? "done" : "") + (i === st.at ? " here" : ""); b.onclick = function () { go(i); }; s.appendChild(b); });
    status(D.rows.filter(done).length + " of " + D.rows.length + " rows answered.");
  }
  function go(i) { st.at = Math.max(0, Math.min(D.rows.length - 1, i)); save(); render(); window.scrollTo(0, 0); }
  function render() {
    var r = D.rows[st.at], host = document.getElementById("row"); host.textContent = "";
    var c = el("div", { class: "card" });
    c.appendChild(el("h2", null, "Row " + r.rid + " of " + D.rows.length + ': "' + r.word + '"'));
    c.appendChild(el("p", { class: "muted" }, "The student wrote:")); c.appendChild(el("div", { class: "reply" }, r.ask));
    c.appendChild(el("p", { class: "muted" }, "The tutor replied:")); c.appendChild(el("div", { class: "reply" }, r.reply));
    var a = st.answers[r.rid] || (st.answers[r.rid] = {});
    qs(r).forEach(function (q) {
      var box = el("div", { class: "q" }); box.appendChild(el("p", null, text(q, r)));
      ["yes", "no"].forEach(function (v) {
        var l = el("label"), i = el("input", { type: "radio", name: r.rid + ":" + q.id, value: v });
        if (a[q.id] === v) i.checked = true;
        i.onchange = function () { a[q.id] = v; save(); strip(); };
        l.appendChild(i); l.appendChild(document.createTextNode(v === "yes" ? " Yes" : " No")); box.appendChild(l);
      });
      c.appendChild(box);
    });
    var ta = el("textarea", { "aria-label": "Note" }); ta.value = a.note || ""; ta.oninput = function () { a.note = ta.value; save(); };
    c.appendChild(el("p", { class: "muted" }, "Note (optional)")); c.appendChild(ta);
    host.appendChild(c); strip();
  }
  var g = document.getElementById("grader"); g.value = st.grader; g.oninput = function () { st.grader = g.value.trim(); save(); };
  document.getElementById("prev").onclick = function () { go(st.at - 1); };
  document.getElementById("next").onclick = function () { go(st.at + 1); };
  document.getElementById("nextOpen").onclick = function () { for (var k = 1; k <= D.rows.length; k++) { var i = (st.at + k) % D.rows.length; if (!done(D.rows[i])) return go(i); } status("Every row is answered. Export."); };
  document.getElementById("export").onclick = function () {
    if (!st.grader) { status("Enter your name first.", true); return; }
    var blob = new Blob([JSON.stringify({ sheet: D.sheet, grader: st.grader, exportedAt: new Date().toISOString(), answers: st.answers }, null, 2)], { type: "application/json" });
    var u = URL.createObjectURL(blob), l = el("a", { href: u, download: "define-labels-" + st.grader.replace(/[^A-Za-z0-9_-]+/g, "_") + ".json" });
    document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  };
  document.getElementById("load").onchange = function (e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    file.text().then(function (t) { var v = JSON.parse(t); if (v.sheet !== D.sheet) throw new Error("that file is for sheet " + v.sheet); st.answers = v.answers || {}; if (v.grader) { st.grader = v.grader; g.value = v.grader; } save(); render(); })
      .catch(function (err) { status("Could not load: " + err.message, true); });
  };
  render();
})();
</script>
</body>
</html>
`;
}

// ── define-label-grader2.ts ──────────────────────────────────────────────────

export interface SheetData { sheet: string; rows: Array<{ rid: string; word: string; kind: DefineKind; ask: string; reply: string }> }

/** The sheet's embedded data, read back out of the HTML. */
export function sheetData(html: string): SheetData {
  const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("No sheet data in that file: is it define-label-sheet.ts's HTML?");
  return JSON.parse(m[1]) as SheetData;
}

const INSTRUCTIONS =
  "You are labelling a tutor's replies for a study. Each item is a student's question about what a word means, and one " +
  "tutor reply. Answer each question about the reply as written, with yes or no. Judge the meaning, not the style: a " +
  "reply can be long, short, simple or formal. Do not reward or punish wording; only whether the meaning is correct.";

/** The request body for one row. Pure, so the prompt the grader sees is pinned by a test. */
export function grader2Request(model: string, row: SheetData["rows"][number]): Record<string, unknown> {
  const qs = DEFINE_LABEL_QUESTIONS.filter((q) => q.kinds.includes(row.kind));
  const user = [
    `The student wrote:\n"""\n${row.ask}\n"""`,
    `The tutor replied:\n"""\n${row.reply}\n"""`,
    ...qs.map((q) => `Question "${q.id}": ${questionText(q, row.word, row.kind)}`),
  ].join("\n\n");
  const properties = Object.fromEntries(qs.map((q) => [q.id, { type: "string", enum: ["yes", "no"] }]));
  return {
    model,
    messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: user }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "labels", strict: true, schema: { type: "object", properties, required: qs.map((q) => q.id), additionalProperties: false } },
    },
  };
}
