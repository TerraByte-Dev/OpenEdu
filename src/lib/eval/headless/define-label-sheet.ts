// Build the define suite's hand-label sheet (BENCHMARKS.md B8, lever 18's validation gate): one
// self-contained HTML file for the graders, plus the hidden verdicts file define-kappa.ts reads.
// Offline: no model call.
//
//   $env:DEFINE_LABEL_FILES = "<B dev file>,<D dev file>[,<more dev files>]"
//   npx vite-node src/lib/eval/headless/define-label-sheet.ts
//
// Kappa sheet (the default): 60 rows drawn by define-label.ts selectDefineLabelRows from the non-ERROR
// rows of the given dev results files. Harm adjudication (DEFINE_LABEL_ITEMS=<ids>): every non-ERROR
// row of those items in the given files (both arms, every repeat). Either way the rows are shuffled and
// the sheet shows only the student's message and the reply: never the arm, the model, the lexical
// verdict, the expect terms or the dictionary note.
//
// Writes <main checkout>/.dev/define-label-sheet[-adjudication].html and the verdicts to
// <main checkout>/.dev/label-verdicts/<sheet id>.json (DEFINE_LABEL_VERDICTS overrides; never in the
// sheet's folder). define-grade.ts and define-items.ts must be committed: the sheet id names them.

import { DEFINE_ITEMS, DEFINE_SPLIT } from "../define-items";
import { gradeDefine } from "../define-grade";
import {
  DEFINE_LABEL_QUESTIONS, DEFINE_LABEL_SEED, SENSE_CLAUSE, selectDefineLabelRows, shuffled,
  type DefineLabelCandidate, type DefineLabelVerdicts,
} from "../define-label";
import { env, fs, lastCommitOf, mainCheckout, path, writeText } from "./node-io";

interface SavedRow { id: string; repeat: number; error: string | null; reply: string; ask: string }
interface Saved { suite: string; model: string; split: string; dictionary: "on" | "off"; rows: SavedRow[] }

async function main(): Promise<void> {
  const e = env();
  const [f, p] = await Promise.all([fs(), path()]);
  const files = (e.DEFINE_LABEL_FILES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (files.length < 2) throw new Error("Set DEFINE_LABEL_FILES to the B and D dev results files (comma-separated).");
  const only = e.DEFINE_LABEL_ITEMS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const grader = `${await lastCommitOf("src/lib/eval/define-grade.ts")}+${await lastCommitOf("src/lib/eval/define-items.ts")}`;
  const sheetId = `define-label-${only ? "adjudication-" : ""}g${grader}`;
  const root = await mainCheckout();
  const sheetFile = p.join(root, ".dev", `define-label-sheet${only ? "-adjudication" : ""}.html`);
  const verdictFile = p.resolve(e.DEFINE_LABEL_VERDICTS ?? p.join(root, ".dev", "label-verdicts", `${sheetId}.json`));
  if (p.dirname(verdictFile).toLowerCase() === p.dirname(sheetFile).toLowerCase()) throw new Error("Write the verdicts outside the sheet's folder.");

  const byId = new Map(DEFINE_ITEMS.map((i) => [i.id, i]));
  const pool: DefineLabelCandidate[] = [];
  const rowOf = new Map<string, { row: SavedRow; source: string }>();
  for (const file of files) {
    const data = JSON.parse(await f.readFile(file, "utf8")) as Saved;
    if (data.suite !== "define") throw new Error(`${file}: not a define results file`);
    // The kappa sheet is drawn from dev rows only; adjudication reads the test rows a harm clause named.
    if (!only && data.split !== "dev") throw new Error(`${file}: the kappa sheet uses dev rows only`);
    const arm = data.dictionary === "off" ? "B" : "D";
    for (const r of data.rows) {
      const item = byId.get(r.id);
      if (!item || r.error || (only && !only.includes(r.id)) || (!only && DEFINE_SPLIT[r.id] !== "dev")) continue;
      // The verdicts come from the grader in this checkout, not the file, so a sheet always matches its id.
      const g = gradeDefine(item, r.reply);
      const uid = `${data.model}|${arm}|${r.id}|${r.repeat}`;
      rowOf.set(uid, { row: r, source: p.relative(root, file) });
      pool.push({ uid, model: data.model, arm, item: r.id, repeat: r.repeat, kind: item.kind, band: item.band, lenient: g.pass, strict: g.passStrict });
    }
  }
  const shown = only ? selectAll(pool) : selectDefineLabelRows(pool);

  const verdicts: DefineLabelVerdicts = { sheet: sheetId, grader, adjudication: !!only, rows: {} };
  const sheetRows = shown.map((c, i) => {
    const rid = `R${String(i + 1).padStart(2, "0")}`;
    const { row, source } = rowOf.get(c.uid)!;
    verdicts.rows[rid] = { source, model: c.model, arm: c.arm, item: c.item, repeat: c.repeat, kind: c.kind, band: c.band, lenient: c.lenient, strict: c.strict };
    return { rid, word: byId.get(c.item)!.word, kind: c.kind, ask: row.ask, reply: row.reply };
  });
  await writeText(sheetFile, renderDefineSheet(sheetId, sheetRows));
  await writeText(verdictFile, JSON.stringify(verdicts, null, 2));
  const n = (t: (c: DefineLabelCandidate) => boolean) => shown.filter(t).length;
  console.log(`Sheet ${sheetId}: ${sheetFile}\nVerdicts (hidden from graders): ${verdictFile}\nRows ${shown.length}: B ${n((c) => c.arm === "B")}, D ${n((c) => c.arm === "D")}, sense ${n((c) => c.kind === "sense")}, lexical fail ${n((c) => !c.lenient)}, sense strict-only fail ${n((c) => c.kind === "sense" && c.lenient && !c.strict)}`);
}

/** Adjudication: every row (both arms, every repeat), in a stable order, shuffled with the frozen seed. */
function selectAll(pool: DefineLabelCandidate[]): DefineLabelCandidate[] {
  return shuffled([...pool].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)), DEFINE_LABEL_SEED);
}

interface SheetRow { rid: string; word: string; kind: "plain" | "sense"; ask: string; reply: string }

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

if ((globalThis as { process?: { argv: string[] } }).process?.argv.some((a) => /define-label-sheet\.ts$/.test(a))) await main();
