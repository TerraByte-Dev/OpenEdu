// Offline simulation behind PRs #227 and #228 (scripts/eval-offline/README.md): retrieval, what a model
// would be shown, and the notes-miss switch with and without lever 9g's sentence check, on long chunked
// dev notes. Embeddings only (Ollama, nomic-embed-text); no chat model. Writes <file>.sim.json beside the
// input. Usage: npx vite-node scripts/eval-offline/long-notes-sim.ts [file]
// The lexWindow / embedding-window variants are the two windows compared before passageFor was written.
import { notesMissThing, askedThing } from "../../src/lib/kernel/askedThing";
import { estTokens, capText } from "../../src/lib/kernel/budget";
import { readFileSync, writeFileSync } from "node:fs";
import { contentWords, passageFor } from "../../src/lib/kernel/ground";
import { stem } from "../../src/lib/kernel/askedThing";
const CAP = 250 * 4 - 60; // shown chars, less room for a marker
const splitS = (t: string) => t.split(/\n{2,}/).flatMap((p) => p.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
// Contiguous sentences around the best-scoring one, extended right then left while they fit.
function windowAround(ss: string[], score: number[]): string {
  let b = 0; for (let i = 1; i < ss.length; i++) if (score[i] > score[b]) b = i;
  let lo = b, hi = b, len = ss[b].length;
  for (let grew = true; grew;) { grew = false;
    if (hi + 1 < ss.length && len + 1 + ss[hi + 1].length <= CAP) { hi++; len += 1 + ss[hi].length; grew = true; }
    if (lo > 0 && len + 1 + ss[lo - 1].length <= CAP) { lo--; len += 1 + ss[lo].length; grew = true; } }
  return ss.slice(lo, hi + 1).join(" ");
}
function lexWindow(text: string, q: string): string {
  if (text.length <= CAP) return text;
  const need = new Set(contentWords(q).map(stem)); const ss = splitS(text);
  return windowAround(ss, ss.map((s) => new Set(contentWords(s).map(stem)).size ? [...new Set(contentWords(s).map(stem))].filter((w) => need.has(w)).length : 0));
}
const FILE = process.argv[2] ?? "scripts/eval-offline/dev-long.json";
const data = JSON.parse(readFileSync(FILE, "utf8"));
function chunkText(text: string, maxTokens = 512): string[] { // copy of notebook.ts chunkText
  const clean = text.replace(/\r\n/g, "\n").trim(); if (!clean) return [];
  const sentences = clean.split(/\n{2,}/).flatMap((p) => p.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = []; let cur = "";
  for (const s of sentences) {
    if (cur && estTokens(cur) + estTokens(s) > maxTokens) { chunks.push(cur.trim()); cur = ""; }
    if (estTokens(s) > maxTokens) { if (cur) { chunks.push(cur.trim()); cur = ""; } const span = maxTokens * 4; for (let i = 0; i < s.length; i += span) chunks.push(s.slice(i, i + span)); continue; }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) chunks.push(cur.trim()); return chunks;
}
async function embed(input: string[]): Promise<number[][]> {
  const r = await fetch("http://127.0.0.1:11434/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "nomic-embed-text", input }) });
  return (await r.json()).embeddings;
}
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / Math.sqrt(x * y); };
const chunks: { title: string; text: string; v: number[] }[] = [];
for (const n of data.notes) { const cs = chunkText(n.text); const vs = await embed(cs); cs.forEach((c, i) => chunks.push({ title: n.title, text: c, v: vs[i] })); }
const sentCache = new Map<string, { s: string; v: number[] }[]>();
async function sents(t: string) { if (!sentCache.has(t)) { const ss = t.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3); const vs = await embed(ss); sentCache.set(t, ss.map((s, i) => ({ s, v: vs[i] }))); } return sentCache.get(t)!; }
const rows: any[] = [];
for (const x of data.items) {
  const [q] = await embed([x.ask]);
  const th = askedThing(x.ask); const [p] = await embed([th?.phrase ?? x.ask]);
  const scored = chunks.map((c) => ({ ...c, score: cos(q, c.v) })).sort((a, b) => b.score - a.score).slice(0, 6);
  const per = new Map<string, number>(); const hits: any[] = [];
  for (const h of scored.filter((h) => h.score >= 0.45)) { if (hits.length >= 3) break; const s = per.get(h.title) ?? 0; if (s >= 2) continue; per.set(h.title, s + 1); hits.push(h); }
  const shownText = hits.map((h) => capText(h.text, 250));
  const alts = (x.expect ?? "").split("|").map((a: string) => a.trim()).filter(Boolean);
  const inFull = hits.some((h) => alts.some((a: string) => h.text.includes(a)));
  const inShown = shownText.some((t) => alts.some((a: string) => t.includes(a)));
  const ownRetrieved = hits.some((h) => h.title === x.noteTitle);
  const multi = /[.?!]\s+\S/.test(x.ask.trim());
  const lexFull = hits.length && !multi ? notesMissThing(x.ask, hits.map((h) => h.text)).fire : false;
  const lexShown = hits.length ? notesMissThing(x.ask, shownText).fire : false;
  let sentQ = 0, sentP = 0, sentQshown = 0;
  for (const h of hits) for (const s of await sents(h.text)) { sentQ = Math.max(sentQ, cos(q, s.v)); sentP = Math.max(sentP, cos(p, s.v)); }
  for (const t of shownText) for (const s of await sents(t)) sentQshown = Math.max(sentQshown, cos(q, s.v));
  const lexShownT = hits.map((h) => lexWindow(h.text, x.ask));
  const embShownT: string[] = [];
  for (const h of hits) { if (h.text.length <= CAP) { embShownT.push(h.text); continue; } const ss = splitS(h.text); const vs = await embed(ss); embShownT.push(windowAround(ss, vs.map((v) => cos(q, v)))); }
  const has = (ts: string[]) => ts.some((t) => alts.some((a: string) => t.includes(a)));
  const codeT = hits.map((h) => passageFor(h.text, x.ask));
  rows.push({ inCode: has(codeT), poisonCode: x.poison ? codeT.some((t) => t.includes(x.poison)) : null, codeLens: codeT.map((t) => t.length), inLexWin: has(lexShownT), inEmbWin: has(embShownT), poisonLexWin: x.poison ? lexShownT.some((t) => t.includes(x.poison)) : null, poisonEmbWin: x.poison ? embShownT.some((t) => t.includes(x.poison)) : null, id: x.id, pos: x.kind === "positive", ask: x.ask, phrase: th?.phrase ?? null, nHits: hits.length, ownRetrieved, inFull, inShown, sQ: hits[0]?.score ?? 0, lexFull, lexShown, sentQ, sentP, sentQshown, poisonShown: x.poison ? shownText.some((t) => t.includes(x.poison)) : null });
}
writeFileSync(FILE.replace(/\.json$/, ".sim.json"), JSON.stringify(rows, null, 1));
const P = rows.filter((r) => r.pos), N = rows.filter((r) => !r.pos);
console.log(`chunks ${chunks.length} for ${data.notes.length} notes; positives ${P.length}: own note retrieved ${P.filter((r) => r.ownRetrieved).length}, answer in retrieved chunk ${P.filter((r) => r.inFull).length}, answer in SHOWN text ${P.filter((r) => r.inShown).length}`);
console.log(`  passageFor (code): answer shown ${P.filter((r) => r.inCode).length}; poison shown on near-misses ${N.filter((r) => r.poisonCode).length}; max shown len ${Math.max(...rows.flatMap((r) => r.codeLens))}`);
console.log(`  window by question words: answer shown ${P.filter((r) => r.inLexWin).length}; by sentence embedding: ${P.filter((r) => r.inEmbWin).length}`);
console.log(`near-misses ${N.length}: any hit ${N.filter((r) => r.nHits).length}, poison shown head ${N.filter((r) => r.poisonShown).length} lexwin ${N.filter((r) => r.poisonLexWin).length} embwin ${N.filter((r) => r.poisonEmbWin).length}`);
console.log(`lexical alone (full text): ff ${P.filter((r) => r.lexFull).length}/${P.length} catch ${N.filter((r) => r.lexFull).length}/${N.length}`);
for (const k of ["sQ", "sentQ", "sentQshown"]) for (const t of [0.6, 0.65, 0.7]) console.log(`lex&${k}<${t}: ff ${P.filter((r) => r.lexFull && r[k] < t).length} catch ${N.filter((r) => r.lexFull && r[k] < t).length}/${N.length}`);
for (const r of P.filter((r) => r.lexFull)) console.log(`  lexFF ${r.id} sQ=${r.sQ.toFixed(2)} sentQ=${r.sentQ.toFixed(2)} "${r.phrase}" | ${r.ask}`);
