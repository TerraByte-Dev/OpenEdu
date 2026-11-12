// The "define" suite runner (docs/BENCHMARKS.md B8, lever 18; issue #251): one student turn per item,
// "what does X mean", through the real kernel, configured as ChatTab runs a turn for a learner in an
// English Language Arts course: no stored instructions (the default identity), no persona, no syllabus,
// the "explain" skill plus the domain skill the topic routes to, retrieval "always", and the reading-
// level line for the item's band (define-items.ts DEFINE_BAND_GRADE: K-2 grade 2, 3-5 grade 4, 6-8
// grade 7, 9-12 grade 10). Grader: define-grade.ts.
//
// From a terminal: EVAL_SUITE=define npm run eval (headless/run.ts; options in headless/README.md). Two
// arms at one commit: EVAL_DICTIONARY=off (B, no note) and unset (D, the app's behaviour). Compare them
// offline with headless/define-compare.ts.

import { tutorEngine } from "../kernel";
import type { ToolContext } from "../tools";
import { callLLMTurn } from "../llm";
import { buildSystemPrompt } from "../curriculum";
import { chatTurnSkills } from "../kernel/chatSkills";
import { estTokens } from "../kernel/budget";
import { readingLevelLayer } from "../grade";
import { assertLibraryGuards, watched } from "./k12-runner";
import { k12FlowSetup } from "./k12-flow-runner";
import { DEFINE_BAND_GRADE, DEFINE_ITEMS, DEFINE_SPLIT, type DefineItem, type DefineKind, type DefineSplit } from "./define-items";
import { DEFINE_GROUPS, gradeDefine, inGroup, type DefineGrade, type DefineGroup } from "./define-grade";
import { wilson95 } from "./k12-fixture";
import type { GradeBand } from "../grade";
import type { ModelTier } from "../../types";
import type { Blind19Kind } from "./blind19";

/** What the runner needs of an item: B8's items (graded by define-grade.ts), or blind-19's (lever 19,
 *  no term lists: graded only by the two blind model graders, so their rows carry grade null). */
export type DefineRunItem = Pick<DefineItem, "id" | "band" | "ask" | "word"> & { kind: DefineKind | Blind19Kind; expect?: string[] };
export type DefineRunSplit = DefineSplit | "blind-19";

/** The course topic: a word question is an English question. Frozen with the pre-registration. */
export const DEFINE_TOPIC = "English Language Arts";
export const DEFINE_MODE = "explain";
// Never created: notebook grounding finds nothing, the library is the corpus, as in k12-flow.
const DEFINE_COURSE_ID = "__eval_define__";
/** A turn with no reply is retried once; a reply never is (k12-flow's rule). */
const MAX_ATTEMPTS = 2;

/** The system prompt and skills for an item's band, built the way ChatTab builds them. Pure. */
export function defineTurnSetup(band: GradeBand, tier: ModelTier, supportsTools: boolean) {
  const { activeSkill, domainSkill, skillSuffix } = chatTurnSkills(DEFINE_MODE, DEFINE_TOPIC, tier, supportsTools);
  const system = buildSystemPrompt({}, null, 1, DEFINE_TOPIC, skillSuffix, undefined, undefined, readingLevelLayer(DEFINE_BAND_GRADE[band]));
  return { system, activeSkill, domainSkill };
}

export interface DefineRow {
  id: string;
  band: GradeBand;
  kind: DefineKind | Blind19Kind;
  split: DefineRunSplit;
  repeat: number;
  ask: string;
  /** The kernel's own report: the word it detected, and the entry + note it appended (null for none). */
  askedWord: string | null;
  dictionaryNote: string | null;
  noteTokens: number;
  reply: string;
  stopReason: string | null;
  attempts: number;
  /** The final attempt's tool calls and tool-call recovery (TutorTurnResult), for the cost clause. */
  toolCalls: Array<{ name: string; ok: boolean }>;
  toolCallRecovery: { iteration: number; error: string } | null;
  /** Chat requests the row sent, over all its attempts (the warm-up is not counted): turn requests,
   *  and structured ones (a request with a `format`, which no define turn should send). Counted on the
   *  wire; the define runner is headless-only. */
  chatRequests: number;
  structuredRequests: number;
  /** Set for an ERROR row (no reply after MAX_ATTEMPTS); `grade` is then null. A blind-19 row has no
   *  lexical grade either: `error` null and `grade` null. */
  error: string | null;
  ttftMs: number | null;
  totalMs: number;
  grade: DefineGrade | null;
}

export interface DefineSummaryCell { group: DefineGroup; repeat: number; k: number; n: number; wilson: [number, number] }

export interface DefineReport {
  model: string;
  provider: string;
  contextTokens: number;
  supportsTools: boolean;
  dictionary: "on" | "off";
  split: DefineRunSplit;
  repeats: number;
  /** True for anything short of every item of the split. A partial run is not a result. */
  partial: boolean;
  /** Rows whose message the detector read as the item's word (must be every row). */
  detected: number;
  /** Rows that got a dictionary note. */
  noted: number;
  errors: number;
  /** True when ERROR rows exceed 2% of rows: the run is void. */
  void: boolean;
  rows: DefineRow[];
  /** Per repeat and group, rows passing (lenient, or strict for the -strict groups). */
  summary: DefineSummaryCell[];
}

export class DefineAbort extends Error {}

const CHAT_PATHS = new Set(["/api/chat", "/v1/chat/completions", "/v1/messages"]);

/** Count chat requests while `body` runs: wraps globalThis.fetch (the headless plugin-http shim reads it
 *  on every call) and restores it after. Requests are unchanged. */
async function countingChat<T>(body: (count: () => { turn: number; structured: number }) => Promise<T>): Promise<T> {
  const inner = globalThis.fetch;
  const n = { turn: 0, structured: 0 };
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (CHAT_PATHS.has(new URL(url, "http://app.invalid").pathname)) {
      let structured = false;
      try { structured = init?.body ? JSON.parse(String(init.body)).format !== undefined : false; } catch { /* not JSON */ }
      if (structured) n.structured++;
      else n.turn++;
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    return await body(() => ({ ...n }));
  } finally {
    globalThis.fetch = inner;
  }
}

/** Per repeat and pre-registered group, rows passing. ERROR rows count as fails. */
export function summarizeDefine(rows: readonly DefineRow[], repeats: number): DefineSummaryCell[] {
  const byId = new Map(DEFINE_ITEMS.map((i) => [i.id, i]));
  const out: DefineSummaryCell[] = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const group of DEFINE_GROUPS) {
      // B8's groups only: blind-19 rows have no lexical grade and no group.
      const sel = rows.filter((r) => r.repeat === repeat && byId.has(r.id) && inGroup(byId.get(r.id)!, group));
      const k = sel.filter((r) => r.grade && (group.endsWith("-strict") ? r.grade.passStrict : r.grade.pass)).length;
      out.push({ group, repeat, k, n: sel.length, wilson: wilson95(k, sel.length) });
    }
  }
  return out;
}

/** The items of a split, in file order, optionally only some ids. */
export function selectDefineItems(split: DefineSplit, only?: string): DefineItem[] {
  const ids = only?.split(",").map((s) => s.trim()).filter(Boolean);
  const pool = DEFINE_ITEMS.filter((i) => DEFINE_SPLIT[i.id] === split);
  if (!ids) return pool;
  const bad = ids.filter((id) => !pool.some((i) => i.id === id));
  if (bad.length) throw new Error(`EVAL_ONLY: not ${split} define items: ${bad.join(", ")}`);
  return pool.filter((i) => ids.includes(i.id));
}

/**
 * Run `items` × `repeats` turns, repeat by repeat, through the kernel. `onRows` gets the row log before
 * the first turn and it fills as turns complete, so a void run (DefineAbort) leaves its rows with the
 * caller.
 */
export async function runDefineItems(
  items: readonly DefineRunItem[],
  opts: { split: DefineRunSplit; dictionary: "on" | "off"; repeats: number; onRows?: (rows: DefineRow[]) => void },
): Promise<DefineReport> {
  const setup = await k12FlowSetup();
  const { config, profile, contextTokens } = setup;
  await assertLibraryGuards();
  const total = items.length * opts.repeats;
  const errorLimit = Math.floor(0.02 * total) + 1;
  console.log(`[define] ${config.provider}/${config.model} ctx=${contextTokens} tools=${profile.supportsTools} dictionary=${opts.dictionary} · ${opts.split} · ${items.length} item(s) × ${opts.repeats}`);

  // Warm-up, unscored: a cold model load can outlast the first-byte timeout.
  await watched(async (signal) => {
    for await (const ev of callLLMTurn([{ role: "user", content: "Reply with the single word: ready" }], config, { tier: profile.tier, signal })) void ev;
  }).catch(() => {});

  const rows: DefineRow[] = [];
  opts.onRows?.(rows);
  await countingChat(async (count) => {
    for (let repeat = 0; repeat < opts.repeats; repeat++) {
      for (const item of items) {
        await assertLibraryGuards().catch((e) => {
          throw new DefineAbort(`VOID RUN — ${e instanceof Error ? e.message : String(e)}`);
        });
        const { system, activeSkill, domainSkill } = defineTurnSetup(item.band, profile.tier, profile.supportsTools);
        const before = count();
        const sent = () => { const now = count(); return { chatRequests: now.turn - before.turn, structuredRequests: now.structured - before.structured }; };
        let row: DefineRow | null = null;
        let lastError = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !row; attempt++) {
          const started = Date.now();
          let ttftMs: number | null = null;
          try {
            const result = await watched((signal) => tutorEngine.run(
              {
                messages: [{ role: "system", content: system }, { role: "user", content: item.ask }],
                config,
                retrieval: "always",
                dictionary: opts.dictionary,
                onText: () => { if (ttftMs === null) ttftMs = Date.now() - started; },
              },
              {
                courseId: DEFINE_COURSE_ID, level: 1, syllabus: null, modelTier: profile.tier, contextTokens,
                permissionMode: "default", config, abort: signal, activeSkill, domainSkill,
                confirmTool: async () => true, supportsTools: profile.supportsTools,
              } satisfies ToolContext,
            ));
            const replied = result.text.trim() !== "" && result.stopReason !== "aborted" && result.stopReason !== "stalled";
            if (!replied) { lastError = `no reply (${result.stopReason})`; continue; }
            row = {
              id: item.id, band: item.band, kind: item.kind, split: opts.split, repeat, ask: item.ask,
              askedWord: result.askedWord, dictionaryNote: result.dictionaryNote,
              noteTokens: result.dictionaryNote ? estTokens(result.dictionaryNote) : 0,
              reply: result.text, stopReason: result.stopReason, attempts: attempt,
              toolCalls: result.toolCalls.map(({ name, ok }) => ({ name, ok })), toolCallRecovery: result.toolCallRecovery,
              ...sent(), error: null,
              ttftMs, totalMs: Date.now() - started, grade: item.expect ? gradeDefine(item as DefineItem, result.text) : null,
            };
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        row ??= {
          id: item.id, band: item.band, kind: item.kind, split: opts.split, repeat, ask: item.ask,
          askedWord: null, dictionaryNote: null, noteTokens: 0, reply: `ERROR: ${lastError}`, stopReason: null,
          attempts: MAX_ATTEMPTS, toolCalls: [], toolCallRecovery: null, ...sent(), error: lastError, ttftMs: null, totalMs: 0, grade: null,
        };
        rows.push(row);
        const g = row.grade;
        console.log(`[define] r${repeat} ${item.id.padEnd(13)} ${row.error ? "ERROR" : g ? `${g.pass ? "PASS" : "fail"}${item.kind === "sense" ? `/${g.passStrict ? "PASS" : "fail"}` : ""}` : "done"} note ${row.dictionaryNote ? `${row.noteTokens} tok` : "-"} · ttft/total ms ${row.ttftMs ?? "-"}/${row.totalMs}`);
        const errors = rows.filter((r) => r.error).length;
        if (errors >= errorLimit) throw new DefineAbort(`VOID RUN — ${errors} ERROR rows of ${total} turns (limit ${errorLimit}) at ${item.id}. Discard it whole.`);
      }
    }
  });

  const summary = summarizeDefine(rows, opts.repeats);
  const byId = new Map(items.map((i) => [i.id, i]));
  const errors = rows.filter((r) => r.error).length;
  const report: DefineReport = {
    model: config.model,
    provider: config.provider,
    contextTokens,
    supportsTools: profile.supportsTools,
    dictionary: opts.dictionary,
    split: opts.split,
    repeats: opts.repeats,
    // blind-19 always runs whole (EVAL_ONLY is refused on it).
    partial: opts.split === "blind-19" ? false : items.length !== DEFINE_ITEMS.filter((i) => DEFINE_SPLIT[i.id] === opts.split).length,
    detected: rows.filter((r) => !r.error && r.askedWord?.toLowerCase() === byId.get(r.id)!.word).length,
    noted: rows.filter((r) => r.dictionaryNote).length,
    errors,
    void: errors >= errorLimit,
    rows,
    summary,
  };
  console.log(`\n[define] ── summary (${opts.dictionary === "off" ? "B, no note" : "D, dictionary note"}) ──`);
  console.log(`[define] detected ${report.detected}/${rows.length} · noted ${report.noted}/${rows.length} · errors ${errors}`);
  for (const c of summary) console.log(`[define]   r${c.repeat} ${c.group.padEnd(13)} ${c.k}/${c.n}`);
  if (report.partial) console.log("[define] PARTIAL RUN — not a result");
  return report;
}
