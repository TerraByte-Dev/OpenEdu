// Offline simulation behind PR #228's dev table, short-note half (scripts/eval-offline/README.md): for
// every positive and near-miss in dev-v2, the v1 dev split, the probe and blind-9f (dev since 9f), the
// notes-miss word switch (with the multi-sentence guard) on the item's own note, and lever 9g's sentence
// check (best cosine between the question and any sentence of that note). Embeddings only (Ollama,
// nomic-embed-text); no chat model. Joins long-notes-sim.ts's output for the five-set table.
// Usage: npx vite-node scripts/eval-offline/long-notes-sim.ts && npx vite-node scripts/eval-offline/short-sets-sim.ts
import { notesMissThing } from "../../src/lib/kernel/askedThing";
import { meaningSentences } from "../../src/lib/kernel/meaning";
import { RAG_DEV_V2, RAG_DEV_V2_VAULT } from "../../src/lib/eval/rag-dev-v2";
import { RAG_FIXTURE } from "../../src/lib/eval/rag-fixture";
import { RAG_HELDOUT } from "../../src/lib/eval/rag-heldout";
import { RAG_PROBE_ITEMS } from "../../src/lib/eval/rag-probe";
import { RAG_BLIND_9F_ITEMS, RAG_BLIND_9F_VAULT } from "../../src/lib/eval/rag-blind";
import { readFileSync } from "node:fs";

type Row = { set: string; pos: boolean; ask: string; text: string };
const rows: Row[] = [];
const text = new Map([...RAG_DEV_V2_VAULT, ...RAG_FIXTURE, ...RAG_BLIND_9F_VAULT].map((n) => [n.title, n.text]));
for (const q of RAG_DEV_V2) rows.push({ set: "dev-v2", pos: q.kind === "positive", ask: q.ask, text: text.get(q.note)! });
for (const q of RAG_HELDOUT.filter((x) => x.split === "dev" && (x.group === "near-miss" || x.group === "paraphrase") && !x.lang)) rows.push({ set: "v1-dev", pos: q.kind === "positive", ask: q.ask, text: text.get(q.note)! });
for (const x of RAG_PROBE_ITEMS) rows.push({ set: "probe", pos: x.kind === "positive", ask: x.ask, text: text.get(x.noteTitle)! });
for (const x of RAG_BLIND_9F_ITEMS) rows.push({ set: "blind-9f", pos: x.kind === "positive", ask: x.ask, text: text.get(x.noteTitle)! });

async function embed(input: string[]): Promise<number[][]> {
  const r = await fetch("http://127.0.0.1:11434/api/embed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "nomic-embed-text", input }) });
  return (await r.json()).embeddings;
}
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; } return d / Math.sqrt(x * y); };

type Scored = { set: string; pos: boolean; lexFull: boolean; sentQ: number };
const out: Scored[] = [];
for (const r of rows) {
  const multi = /[.?!]\s+\S/.test(r.ask.trim());
  const [q, ...vs] = await embed([r.ask, ...meaningSentences([r.text])]);
  out.push({ set: r.set, pos: r.pos, lexFull: !multi && notesMissThing(r.ask, [r.text]).fire, sentQ: Math.max(...vs.map((v) => cos(q, v))) });
}
const long = JSON.parse(readFileSync("scripts/eval-offline/dev-long.sim.json", "utf8")) as Array<Scored & { id: string }>;
const all = [...out, ...long.map((x) => ({ ...x, set: "dev-long" }))];
for (const t of [0.66, 0.68, 0.7, 0.72]) {
  const P = all.filter((x) => x.pos), N = all.filter((x) => !x.pos);
  const per = ["dev-v2", "v1-dev", "probe", "blind-9f", "dev-long"].map((s) => `${s} ${P.filter((x) => x.set === s && x.lexFull && x.sentQ < t).length}/${N.filter((x) => x.set === s && x.lexFull && x.sentQ < t).length}`).join(", ");
  console.log(`check < ${t}: right notes hidden ${P.filter((x) => x.lexFull && x.sentQ < t).length}/${P.length}, near-misses caught ${N.filter((x) => x.lexFull && x.sentQ < t).length}/${N.length} [${per}]`);
}
const P = all.filter((x) => x.pos), N = all.filter((x) => !x.pos);
console.log(`word switch alone: right notes hidden ${P.filter((x) => x.lexFull).length}/${P.length}, near-misses caught ${N.filter((x) => x.lexFull).length}/${N.length}`);
