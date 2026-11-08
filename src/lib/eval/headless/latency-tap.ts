// The B7 request log. Wraps globalThis.fetch (which the headless plugin-http shim looks up on every
// call), so it sees every /api/chat and /api/embed request the kernel sends, and records what Ollama
// reports at the end of each: load_duration, prompt_eval_count/duration, eval_count/duration. It
// never changes a request. Each request carries the label the driver set when it was sent, which is
// how latency.ts gives every request to its turn.
//
// wire.ts (EVAL_WIRE) logs chat requests only and has no labels; B7 needs the embeds and the first
// byte too, and keeps the existing `wire` output of other suites unchanged.

export interface TapCall {
  seq: number;
  /** The driver's label when the request was sent (latency.ts: "<kind>#<rep>"), or null. */
  label: string | null;
  path: "/api/chat" | "/api/embed";
  /** "structured" when a chat request carried a `format` (callLLMStructured), "turn" for any other
   *  chat request, "embed" for /api/embed. */
  kind: "turn" | "structured" | "embed";
  /** Chat: the last user message (structured: the one before its final instruction). Embed: "". */
  ask: string;
  /** Embed: the texts embedded. Chat: []. */
  inputs: string[];
  status: number;
  /** When the request was sent, in ms since the tap was installed. */
  sentAt: number;
  /** From sending to the first chunk of the response body. */
  firstByteMs: number | null;
  /** From sending to the end of the response body. */
  ms: number | null;
  loadMs: number | null;
  promptEvalCount: number | null;
  promptEvalMs: number | null;
  evalCount: number | null;
  evalMs: number | null;
}

const ns = (v: unknown) => (typeof v === "number" ? Math.round(v / 1e6) : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

type Msg = { role: string; content: string };

export interface Tap {
  calls: TapCall[];
  /** Label for requests sent from now on. */
  label: string | null;
  /** The fetch underneath the tap, for the driver's own /api/ps and unload requests. */
  rawFetch: typeof fetch;
  /** Wait until every recorded response has been read to the end. */
  settle(): Promise<void>;
  /** Put the previous globalThis.fetch back. */
  uninstall(): void;
}

/** The final timing object of a response body: the `done: true` line of a chat stream, or the one
 *  JSON object of a non-streamed chat or an embed. */
function finalObject(text: string): Record<string, unknown> | null {
  const objs = text.trim().split("\n").map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  return objs.filter((o) => o.done === true).pop() ?? (objs.length === 1 ? objs[0] : null);
}

export function installTap(): Tap {
  const inner = globalThis.fetch;
  const t0 = performance.now();
  const pending: Promise<void>[] = [];
  const tap: Tap = {
    calls: [],
    label: null,
    rawFetch: inner,
    settle: async () => { await Promise.all(pending); },
    uninstall: () => { globalThis.fetch = inner; },
  };

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    // App-origin requests (/library/…) are relative; give them a base rather than throw on them.
    const path = new URL(input instanceof Request ? input.url : String(input), "http://app.invalid").pathname;
    if (path !== "/api/chat" && path !== "/api/embed") return inner(input, init);
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; } catch { /* not JSON: logged without fields */ }

    const users = ((body.messages as Msg[] | undefined) ?? []).filter((m) => m.role === "user");
    const structured = path === "/api/chat" && body.format !== undefined;
    const about = structured ? users[users.length - 2] : users[users.length - 1];
    const rawInput = body.input;
    const entry: TapCall = {
      seq: tap.calls.length,
      label: tap.label,
      path,
      kind: path === "/api/embed" ? "embed" : structured ? "structured" : "turn",
      ask: path === "/api/chat" ? about?.content ?? "" : "",
      inputs: path === "/api/embed" ? (Array.isArray(rawInput) ? rawInput.map(String) : typeof rawInput === "string" ? [rawInput] : []) : [],
      status: 0,
      sentAt: Math.round(performance.now() - t0),
      firstByteMs: null, ms: null, loadMs: null, promptEvalCount: null, promptEvalMs: null, evalCount: null, evalMs: null,
    };
    tap.calls.push(entry);
    const started = performance.now();
    const res = await inner(input, init);
    entry.status = res.status;
    const reader = res.clone().body?.getReader();
    pending.push((async () => {
      if (!reader) return;
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (entry.firstByteMs === null) entry.firstByteMs = Math.round(performance.now() - started);
        text += dec.decode(value, { stream: true });
      }
      text += dec.decode();
      entry.ms = Math.round(performance.now() - started);
      const last = finalObject(text);
      if (!last) return;
      entry.loadMs = ns(last.load_duration);
      entry.promptEvalCount = num(last.prompt_eval_count);
      entry.promptEvalMs = ns(last.prompt_eval_duration);
      entry.evalCount = num(last.eval_count);
      entry.evalMs = ns(last.eval_duration);
    })().catch(() => {}));
    return res;
  }) as typeof fetch;

  return tap;
}
