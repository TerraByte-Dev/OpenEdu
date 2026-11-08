// Wire log for latency runs (EVAL_WIRE, EVAL_NUM_GPU). Wraps globalThis.fetch, which the headless
// plugin-http shim looks up on every call, so it sees every request the kernel sends to Ollama.
//
// EVAL_WIRE=1 records, per /api/chat request, what Ollama itself reports in its final message:
// load_duration (a model reload shows up here), prompt_eval_count (tokens evaluated, so a prefix-cache
// miss shows up as a large count), eval_count and the durations. It does not change the request.
//
// EVAL_NUM_GPU=n adds options.num_gpu to every /api/chat and /api/embed request, so the same kernel
// can be timed CPU-only (n = 0) on a machine with a GPU. That DOES change the requests; the results
// file records it, and such a run is a latency run, not a parity run.

export interface WireCall {
  seq: number;
  /** "structured" when the request carried a `format` (callLLMStructured), else "turn". */
  kind: "turn" | "structured";
  /** The user message the call is about: the last user turn, or for a structured call the one before
   *  its final instruction. Truncated. */
  ask: string;
  status: number;
  /** Wall-clock from sending the request to the end of the response body. */
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

export function installWire(opts: { log: boolean; numGpu?: number }): { calls: WireCall[]; settle: () => Promise<void> } {
  const calls: WireCall[] = [];
  const pending: Promise<void>[] = [];
  const inner = globalThis.fetch;
  if (!opts.log && opts.numGpu === undefined) return { calls, settle: async () => {} };

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const path = new URL(String(input)).pathname;
    if (path !== "/api/chat" && path !== "/api/embed") return inner(input, init);
    let body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (body && opts.numGpu !== undefined) {
      body = { ...body, options: { ...(body.options as object | undefined), num_gpu: opts.numGpu } };
      init = { ...init, body: JSON.stringify(body) };
    }
    const started = performance.now();
    const res = await inner(input, init);
    if (!opts.log || path !== "/api/chat" || !body) return res;

    const users = ((body.messages as Msg[] | undefined) ?? []).filter((m) => m.role === "user");
    const structured = body.format !== undefined;
    const about = structured ? users[users.length - 2] : users[users.length - 1];
    const entry: WireCall = {
      seq: calls.length,
      kind: structured ? "structured" : "turn",
      ask: (about?.content ?? "").slice(-120),
      status: res.status,
      ms: null, loadMs: null, promptEvalCount: null, promptEvalMs: null, evalCount: null, evalMs: null,
    };
    calls.push(entry);
    pending.push(res.clone().text().then((text) => {
      entry.ms = Math.round(performance.now() - started);
      const last = text.trim().split("\n").map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
        .filter((x): x is Record<string, unknown> => !!x && x.done === true).pop();
      if (!last) return;
      entry.loadMs = ns(last.load_duration);
      entry.promptEvalCount = num(last.prompt_eval_count);
      entry.promptEvalMs = ns(last.prompt_eval_duration);
      entry.evalCount = num(last.eval_count);
      entry.evalMs = ns(last.eval_duration);
    }).catch(() => {}));
    return res;
  }) as typeof fetch;

  return { calls, settle: async () => { await Promise.all(pending); } };
}
