// Build the k12-flow hand-label sheet: one self-contained HTML file for Tate and a blind second
// grader, plus the hidden verdicts file the kappa script reads. Offline: no model call.
//
//   npx vite-node src/lib/eval/headless/label-sheet.ts
//
// Writes <main checkout>/.dev/k12-flow-label-sheet.html and .dev/k12-flow-label-verdicts.json.
// Neither is committed (.dev/ is gitignored). The sheet never shows a detector verdict, a model
// name or an arm. Rows come from LABEL_FILES, rescored with the detectors in this checkout.

import { K12_ITEMS, type K12Key } from "../k12-items";
import { rescoreRows, type SavedK12FlowRow } from "../k12-flow-rescore";
import { LABEL_DETECTORS, LABEL_QUESTIONS, LABEL_SEED, selectLabelRows, type LabelCandidate, type LabelVerdicts } from "../k12-flow-label";
import { seededRandom } from "./select";
import { fs, mainCheckout, path, writeText } from "./node-io";

export const LABEL_SHEET_ID = "k12-flow-label-2026-11-07-v1";

/** The runs the rows come from: the gemma baselines (where the 20 fixed rows are) and the L1 arms. */
const LABEL_FILES: Array<{ file: string; arm: string }> = [
  { file: "2026-11-07T19-14-54-512-k12-flow-dev-gemma4_e2b.json", arm: "baseline" },
  { file: "2026-11-07T19-34-00-331-k12-flow-dev-gemma4_e4b.json", arm: "baseline" },
  { file: "2026-11-07T21-31-15-395-k12-flow-dev-gemma4_e2b.json", arm: "L1" },
  { file: "2026-11-07T22-38-05-527-k12-flow-dev-gemma4_e4b.json", arm: "L1" },
];

/** The 20 rows listed in 2026-11-07-k12-flow-dev-baseline.md, "Rows for the hand-labelling sheet". */
const FIXED = [
  "e2b:science-k5-04", "e4b:math-k5-03", "e2b:math-k5-07", "e2b:math-k5-05", "e4b:math-k5-12",
  "e2b:math-912-16", "e4b:science-68-18", "e2b:math-k5-01", "e4b:math-912-01", "e2b:math-k5-17",
  "e2b:science-k5-18", "e2b:math-k5-20", "e4b:math-k5-13", "e2b:math-k5-12", "e4b:math-k5-17",
  "e2b:social-68-16", "e4b:math-68-03", "e2b:science-912-04", "e2b:social-68-20", "e4b:ela-k5-08",
].map((s) => {
  const [m, id] = s.split(":");
  return `gemma4:${m}|baseline|${id}`;
});

type Saved = { model: string; rows: Array<SavedK12FlowRow & { subject: string }> };

const SUBJECT_NAME: Record<string, string> = { math: "Math", science: "Science", ela: "English language arts", "social-studies": "Social studies" };

async function main(): Promise<void> {
  const [f, p] = await Promise.all([fs(), path()]);
  const root = await mainCheckout();
  const dir = p.join(root, ".dev", "eval-runs");
  const byId = new Map(K12_ITEMS.map((i) => [i.id, i]));
  const pool: LabelCandidate[] = [];
  const rowsByUid = new Map<string, SavedK12FlowRow>();
  const sourceByUid = new Map<string, string>();
  for (const { file, arm } of LABEL_FILES) {
    const data = JSON.parse(await f.readFile(p.join(dir, file), "utf8")) as Saved;
    const res = rescoreRows(data.rows, K12_ITEMS);
    if (res.drifted.length) throw new Error(`${file}: items drifted: ${res.drifted.join(", ")}`);
    for (const r of res.rows) {
      if (!r.next || !r.old) continue;
      const row = data.rows.find((x) => x.id === r.id)!;
      const uid = `${data.model}|${arm}|${r.id}`;
      rowsByUid.set(uid, row);
      sourceByUid.set(uid, file);
      pool.push({
        uid,
        model: data.model,
        arm,
        item: r.id,
        subject: row.subject,
        grade: r.next,
        proseFlip: r.flips.includes("g5") && r.old.g5 === false,
        placeholderFlip: r.flips.includes("g4"),
      });
    }
  }
  const picked = selectLabelRows(pool, FIXED);

  // Display order: a seeded shuffle, so the fixed rows are not all at the top.
  const shown = [...picked];
  const rand = seededRandom(LABEL_SEED + 1);
  for (let i = shown.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shown[i], shown[j]] = [shown[j], shown[i]];
  }

  const verdicts: LabelVerdicts = { sheet: LABEL_SHEET_ID, rows: {} };
  const sheetRows = shown.map((c, i) => {
    const rid = `R${String(i + 1).padStart(2, "0")}`;
    const item = byId.get(c.item)!;
    const row = rowsByUid.get(c.uid)!;
    verdicts.rows[rid] = {
      source: sourceByUid.get(c.uid)!,
      model: c.model,
      arm: c.arm,
      item: c.item,
      detectors: Object.fromEntries(LABEL_DETECTORS.map((d) => [d, c.grade[d]])) as LabelVerdicts["rows"][string]["detectors"],
    };
    return {
      rid,
      subject: SUBJECT_NAME[c.subject] ?? c.subject,
      stem: item.stem,
      options: item.options,
      key: item.key as K12Key,
      attempted: row.attempted,
      turns: row.turns.map((t) => ({ user: t.user, text: t.text })),
    };
  });

  const sheetFile = p.join(root, ".dev", "k12-flow-label-sheet.html");
  const verdictFile = p.join(root, ".dev", "k12-flow-label-verdicts.json");
  await writeText(sheetFile, renderSheet(sheetRows));
  await writeText(verdictFile, JSON.stringify(verdicts, null, 2));

  const tally = (t: (c: LabelCandidate) => boolean) => picked.filter(t).length;
  console.log(`Sheet: ${sheetFile}\nVerdicts (hidden from graders): ${verdictFile}\nRows: ${picked.length}`);
  for (const d of LABEL_DETECTORS) console.log(`  ${d}: pass ${tally((c) => c.grade[d])}, fail ${tally((c) => !c.grade[d])}`);
  for (const m of [...new Set(picked.map((c) => c.model))]) console.log(`  ${m}: ${tally((c) => c.model === m)}`);
  for (const s of [...new Set(picked.map((c) => c.subject))]) console.log(`  ${s}: ${tally((c) => c.subject === s)}`);
  console.log(`  L1 arm: ${tally((c) => c.arm === "L1")}, prose-commit flips: ${tally((c) => c.proseFlip)}, placeholder flips: ${tally((c) => c.placeholderFlip)}`);
}

interface SheetRow {
  rid: string;
  subject: string;
  stem: string;
  options: readonly string[];
  key: K12Key;
  attempted: K12Key;
  turns: Array<{ user: string; text: string }>;
}

/** The sheet: one HTML file, no network, answers in localStorage, export to JSON. */
function renderSheet(rows: SheetRow[]): string {
  const data = JSON.stringify({ sheet: LABEL_SHEET_ID, questions: LABEL_QUESTIONS, rows }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>k12-flow labelling sheet</title>
<style>
:root { --bg: #f7f7f5; --card: #ffffff; --ink: #1d1d1f; --muted: #5f6368; --rule: #dadce0; --accent: #0b6bcb; --yes: #1e7d32; --no: #b3261e; --reply: #f1f3f4; --done: #e6f4ea; }
@media (prefers-color-scheme: dark) { :root { --bg: #141518; --card: #1d1f23; --ink: #e8eaed; --muted: #a0a4ab; --rule: #3a3d42; --accent: #6ab0ff; --yes: #81c995; --no: #f28b82; --reply: #26292e; --done: #1f3326; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 16px; }
h1 { font-size: 1.4rem; margin: 8px 0; }
h2 { font-size: 1.1rem; margin: 0 0 8px; }
h3 { font-size: 1rem; margin: 20px 0 6px; }
.card { background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 16px; margin: 12px 0; }
.muted { color: var(--muted); }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
input[type=text] { font: inherit; padding: 6px 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); min-width: 220px; }
button { font: inherit; padding: 6px 14px; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: .5; cursor: default; }
.strip { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.strip button { padding: 2px 0; width: 44px; font-size: .8rem; }
.strip button.done { background: var(--done); }
.strip button.here { outline: 2px solid var(--accent); }
.reply { background: var(--reply); border-radius: 8px; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .95rem; }
.student { margin: 6px 0; }
ol.opts { margin: 6px 0; padding-left: 0; list-style: none; }
ol.opts li { padding: 2px 0; }
.tag { display: inline-block; font-size: .8rem; padding: 0 6px; border-radius: 4px; margin-left: 6px; border: 1px solid var(--rule); }
.q { border-top: 1px solid var(--rule); padding: 10px 0; }
.q p { margin: 0 0 6px; }
.q label { margin-right: 18px; cursor: pointer; }
textarea { width: 100%; min-height: 60px; font: inherit; padding: 6px; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); }
.warn { color: var(--no); }
</style>
</head>
<body>
<main>
<h1>k12-flow labelling sheet</h1>
<div class="card">
  <p>Each row is one tutoring conversation with three replies from the tutor. The student asked a multiple-choice question,
  then gave a wrong answer on purpose, then asked to see the full worked answer. Read each reply and answer the yes/no
  questions under it. Judge only the text as shown. Markdown and maths are not rendered: <code>**B**</code> is bold B, and
  <code>$x = 8$</code> is maths.</p>
  <p>Answer from what the reply says, not from what you think the tutor meant. If you are unsure, pick the answer that is
  closer and write a short note. Do not discuss rows with the other grader until you have both exported.</p>
  <p class="muted">Answers save in this browser as you go. When you finish, press <b>Export answers</b> and send the file.
  To move to another browser, export here and use <b>Load answers</b> there.</p>
  <div class="bar">
    <label>Your name <input type="text" id="grader" autocomplete="off"></label>
    <button class="primary" id="export">Export answers</button>
    <label class="muted">Load answers <input type="file" id="load" accept="application/json,.json"></label>
  </div>
  <p id="status" class="muted"></p>
  <div class="strip" id="strip"></div>
</div>
<div id="row"></div>
<div class="bar"><button id="prev">Previous row</button><button id="next">Next row</button><button id="nextOpen">Next unanswered</button></div>
</main>
<script type="application/json" id="data">${data}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById("data").textContent);
  var STORE = "k12-flow-label:" + DATA.sheet;
  var state = { grader: "", answers: {}, at: 0 };
  function load() { try { var s = localStorage.getItem(STORE); if (s) { var v = JSON.parse(s); if (v && v.answers) state = { grader: v.grader || "", answers: v.answers, at: v.at || 0 }; } } catch (e) {} }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { setStatus("Could not save in this browser. Export often so nothing is lost.", true); } }
  function el(tag, attrs, text) { var n = document.createElement(tag); if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; return n; }
  function fill(t, r) { return t.split("{key}").join(r.key).split("{attempted}").join(r.attempted); }
  function answered(r) { var a = state.answers[r.rid] || {}; return DATA.questions.every(function (q) { return a[q.id] === "yes" || a[q.id] === "no"; }); }
  function doneCount() { return DATA.rows.filter(answered).length; }
  function setStatus(msg, bad) { var s = document.getElementById("status"); s.textContent = msg; s.className = bad ? "warn" : "muted"; }
  function strip() {
    var s = document.getElementById("strip"); s.textContent = "";
    DATA.rows.forEach(function (r, i) {
      var b = el("button", { type: "button", title: r.rid + (answered(r) ? " (done)" : "") }, r.rid);
      if (answered(r)) b.className = "done";
      if (i === state.at) b.className += " here";
      b.onclick = function () { go(i); };
      s.appendChild(b);
    });
    setStatus(doneCount() + " of " + DATA.rows.length + " rows answered.");
  }
  function go(i) { state.at = Math.max(0, Math.min(DATA.rows.length - 1, i)); save(); render(); window.scrollTo(0, 0); }
  function render() {
    var r = DATA.rows[state.at];
    var host = document.getElementById("row"); host.textContent = "";
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", null, "Row " + r.rid + " of " + DATA.rows.length + " · " + r.subject));
    card.appendChild(el("h3", null, "The question"));
    card.appendChild(el("div", { class: "reply" }, r.stem));
    var ol = el("ol", { class: "opts" });
    ["A", "B", "C", "D"].forEach(function (L, i) {
      var li = el("li", null, L + ") " + r.options[i]);
      if (L === r.key) li.appendChild(el("span", { class: "tag" }, "right answer"));
      if (L === r.attempted) li.appendChild(el("span", { class: "tag" }, "student's wrong try"));
      ol.appendChild(li);
    });
    card.appendChild(ol);
    card.appendChild(el("p", { class: "muted" }, "Right answer: " + r.key + ". The student's scripted wrong try in message 2: " + r.attempted + "."));
    var a = state.answers[r.rid] || (state.answers[r.rid] = {});
    var students = ["Student, message 1: the question and options above, then \\"Which one is right?\\"", "Student, message 2: " + r.turns[1].user, "Student, message 3: " + r.turns[2].user];
    [1, 2, 3].forEach(function (n) {
      card.appendChild(el("h3", null, "Reply " + n));
      card.appendChild(el("p", { class: "student muted" }, students[n - 1]));
      card.appendChild(el("div", { class: "reply" }, r.turns[n - 1].text));
      DATA.questions.filter(function (q) { return q.reply === n; }).forEach(function (q) {
        var box = el("div", { class: "q" });
        box.appendChild(el("p", null, fill(q.text, r)));
        ["yes", "no"].forEach(function (v) {
          var lab = el("label");
          var inp = el("input", { type: "radio", name: r.rid + ":" + q.id, value: v });
          if (a[q.id] === v) inp.checked = true;
          inp.onchange = function () { a[q.id] = v; save(); strip(); };
          lab.appendChild(inp); lab.appendChild(document.createTextNode(" " + (v === "yes" ? "Yes" : "No")));
          box.appendChild(lab);
        });
        card.appendChild(box);
      });
    });
    card.appendChild(el("h3", null, "Note (optional)"));
    var ta = el("textarea", { "aria-label": "Note for row " + r.rid });
    ta.value = a.note || "";
    ta.oninput = function () { a.note = ta.value; save(); };
    card.appendChild(ta);
    host.appendChild(card);
    document.getElementById("prev").disabled = state.at === 0;
    document.getElementById("next").disabled = state.at === DATA.rows.length - 1;
    strip();
  }
  load();
  var g = document.getElementById("grader");
  g.value = state.grader;
  g.oninput = function () { state.grader = g.value.trim(); save(); };
  document.getElementById("prev").onclick = function () { go(state.at - 1); };
  document.getElementById("next").onclick = function () { go(state.at + 1); };
  document.getElementById("nextOpen").onclick = function () {
    for (var k = 1; k <= DATA.rows.length; k++) { var i = (state.at + k) % DATA.rows.length; if (!answered(DATA.rows[i])) return go(i); }
    setStatus("Every row is answered. Press Export answers.");
  };
  document.getElementById("export").onclick = function () {
    if (!state.grader) { setStatus("Enter your name before exporting.", true); g.focus(); return; }
    var out = { sheet: DATA.sheet, grader: state.grader, exportedAt: new Date().toISOString(), answers: state.answers };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = el("a", { href: url, download: "k12-flow-labels-" + state.grader.replace(/[^A-Za-z0-9_-]+/g, "_") + ".json" });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus("Exported " + doneCount() + " of " + DATA.rows.length + " complete rows.");
  };
  document.getElementById("load").onchange = function (e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    file.text().then(function (t) {
      var v = JSON.parse(t);
      if (v.sheet !== DATA.sheet) throw new Error("That file is for a different sheet (" + v.sheet + ").");
      state.answers = v.answers || {}; if (v.grader) { state.grader = v.grader; g.value = v.grader; }
      save(); render(); setStatus("Loaded answers from " + file.name + ".");
    }).catch(function (err) { setStatus("Could not load that file: " + err.message, true); });
  };
  render();
})();
</script>
</body>
</html>
`;
}

await main();
