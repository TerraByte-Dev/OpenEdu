// Tool calls a model wrote as reply text (B9 readiness run, 2026-11-13). gemma4 has its own tool-call
// syntax: `<|tool_call>call:name{key:<|"|>value<|"|>,...}<tool_call|>`. Ollama turns that into a real
// tool call only when the whole frame is there. On gemma4:e2b, 4 of 220 chat turns wrote it without the
// opening `<|tool_call>call:`, e.g.
//   progress.mark_mastered{status:<|"|>mastered<|"|>,subtopic_id:<|"|>Division as Sharing<|"|>}<tool_call|>
// Ollama passed it through as plain text, so nothing ran and the child saw the syntax.
//
// ReplyTextFilter sits between the stream and everything the student sees or the app saves. It:
//   - holds back any tail of the stream that could still become such a call (so it never shows
//     mid-stream), and drops the call text once it is complete, or at the end of the stream if it
//     never closes;
//   - parses a complete call's arguments strictly (anything this parser does not accept is dropped,
//     never guessed at) and records it; the kernel dispatches a recorded call only when its tool was
//     offered this turn, through dispatchToolCall, the same zod + permission path a native call takes;
//   - drops gemma4's stray control tokens (`<tool_call|>`, `<|tool_response>`, ...) and turns its
//     string quote token `<|"|>` into `"`.
// A call is recognised only by a registered tool's name followed straight by `{`, or after the
// `<|tool_call>` opener. Ordinary prose, code (`list.map{`) and Mermaid (`B{Condition?}`) never match.

export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

const OPENER = "<|tool_call>";
const CLOSER = "<tool_call|>";
const QUOTE = '<|"|>';
// gemma4's other control tokens: `<|name>` opens, `<name|>` closes. One pipe on one side, so HTML
// such as `<b>` never matches.
const TOKEN_RE = /<\|"\|>|<\|[a-z_]+>|<[a-z_]+\|>/;
// The tail of the stream that may be the start of such a token.
const PARTIAL_TOKEN_RE = /<(?:\|[a-z_"]*\|?|[a-z_]*)$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The index just past the `}` that closes the `{` at `open`, or -1 when the text ends first.
 * `<|"|>…<|"|>` and `"…"` strings are skipped, so a brace inside a value does not count.
 */
export function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text.startsWith(QUOTE, i)) {
      const end = text.indexOf(QUOTE, i + QUOTE.length);
      if (end < 0) return -1;
      i = end + QUOTE.length - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) return -1;
      i = j;
    } else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * A gemma4 argument object, `{key:value,...}`, as a plain object, or null when it is not exactly that.
 * Values: `<|"|>string<|"|>`, a JSON string, a number, true / false / null, `[...]`, `{...}`.
 * Keys: a bare identifier or either kind of string.
 */
export function parseGemmaArgs(text: string): Record<string, unknown> | null {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const fail = Symbol("fail");
  type Out = unknown | typeof fail;

  const str = (): string | typeof fail => {
    if (text.startsWith(QUOTE, i)) {
      const end = text.indexOf(QUOTE, i + QUOTE.length);
      if (end < 0) return fail;
      const s = text.slice(i + QUOTE.length, end);
      i = end + QUOTE.length;
      return s;
    }
    if (text[i] === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i));
      if (!m) return fail;
      try { i += m[0].length; return JSON.parse(m[0]) as string; } catch { return fail; }
    }
    return fail;
  };

  const value = (): Out => {
    ws();
    if (text.startsWith(QUOTE, i) || text[i] === '"') return str();
    if (text[i] === "{") return obj();
    if (text[i] === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") { i++; return arr; }
      for (;;) {
        const v = value();
        if (v === fail) return fail;
        arr.push(v);
        ws();
        if (text[i] === ",") { i++; ws(); if (text[i] === "]") { i++; return arr; } continue; }
        if (text[i] === "]") { i++; return arr; }
        return fail;
      }
    }
    const lit = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)(?![\w.])/.exec(text.slice(i));
    if (!lit) return fail;
    i += lit[0].length;
    return JSON.parse(lit[0]);
  };

  const obj = (): Record<string, unknown> | typeof fail => {
    if (text[i] !== "{") return fail;
    i++;
    const out: Record<string, unknown> = {};
    ws();
    if (text[i] === "}") { i++; return out; }
    for (;;) {
      ws();
      let key: string | typeof fail;
      const bare = /^[A-Za-z_][\w-]*/.exec(text.slice(i));
      if (bare) { key = bare[0]; i += bare[0].length; } else key = str();
      if (key === fail) return fail;
      ws();
      if (text[i] !== ":") return fail;
      i++;
      const v = value();
      if (v === fail) return fail;
      out[key] = v;
      ws();
      if (text[i] === ",") { i++; ws(); if (text[i] === "}") { i++; return out; } continue; }
      if (text[i] === "}") { i++; return out; }
      return fail;
    }
  };

  ws();
  const result = obj();
  ws();
  return result === fail || i !== text.length ? null : result;
}

/**
 * Filters one model call's streamed text. push() each delta and show what it returns; end() once the
 * stream is over (normally or not) and show that too. `calls` lists the complete calls whose arguments
 * parsed, in order.
 *
 * `toolNames` are the names that mark a call without the `<|tool_call>` opener (every registered tool,
 * so a tool not offered this turn is still dropped). `callable(name)` says whether the kernel will run
 * a call to that tool. After the first call that is callable and parsed, the rest of the stream is
 * dropped: a native call ends the model's turn there too, and text written after it ("I marked that as
 * mastered") would claim a result the tool has not produced yet.
 */
export class ReplyTextFilter {
  readonly calls: TextToolCall[] = [];
  private pending = "";
  private stopped = false;
  private readonly callRe: RegExp | null;
  private readonly triggers: string[];

  constructor(toolNames: readonly string[], private readonly callable: (name: string) => boolean = () => false) {
    const names = [...new Set(toolNames)].sort((a, b) => b.length - a.length);
    this.callRe = names.length ? new RegExp(`(?<![\\w.])(?:call:)?(${names.map(escapeRe).join("|")})\\{`) : null;
    this.triggers = [OPENER, CLOSER, QUOTE, ...names.flatMap((n) => [`${n}{`, `call:${n}{`])];
  }

  /** Whether a callable call was found, so the rest of this stream is being dropped. */
  get stoppedAtCall(): boolean {
    return this.stopped;
  }

  push(delta: string): string {
    if (this.stopped) return "";
    this.pending += delta;
    return this.drain(false);
  }

  end(): string {
    if (this.stopped) return "";
    const out = this.drain(true);
    // What is still held could only have become a call or a token; neither is shown.
    this.pending = "";
    return out;
  }

  private drain(final: boolean): string {
    let out = "";
    for (;;) {
      const text = this.pending;
      const call = this.callRe?.exec(text) ?? null;
      const opener = text.indexOf(OPENER);
      const token = TOKEN_RE.exec(text);
      const starts = [call?.index, opener >= 0 ? opener : undefined, token?.index].filter((n): n is number => n !== undefined);
      if (!starts.length) break;
      const at = Math.min(...starts);
      out += text.slice(0, at);
      const rest = text.slice(at);

      // The call's name and the index of its `{` in `rest`, or why there is none yet.
      let name: string | null = null;
      let brace = -1;
      if (rest.startsWith(OPENER)) {
        const m = /^<\|tool_call>\s*(?:call:)?([A-Za-z_][\w.]*)\{/.exec(rest);
        if (m) { name = m[1]; brace = m[0].length - 1; }
        else if (!final && /^<\|tool_call>[\s\w.:]*$/.test(rest)) { this.pending = rest; return out; }
      } else if (call && call.index === at) {
        name = call[1];
        brace = call[0].length - 1;
      }

      if (name === null) {
        // A stray control token: the quote token reads as a quote, the others as nothing.
        const t = TOKEN_RE.exec(rest)!;
        if (t[0] === QUOTE) out += '"';
        this.pending = rest.slice(t[0].length);
        continue;
      }

      const close = closingBrace(rest, brace);
      if (close < 0) {
        // Not closed yet: hold it. At the end of the stream an unclosed call is dropped.
        this.pending = final ? "" : rest;
        return out;
      }
      let after = rest.slice(close);
      const trimmed = after.replace(/^[ \t]*/, "");
      if (trimmed.startsWith(CLOSER)) after = trimmed.slice(CLOSER.length);
      else if (!final && trimmed.length < CLOSER.length && CLOSER.startsWith(trimmed)) { this.pending = rest; return out; }

      const args = parseGemmaArgs(rest.slice(brace, close));
      if (args) this.calls.push({ name, args });
      if (args && this.callable(name)) {
        this.stopped = true;
        this.pending = "";
        return out;
      }
      this.pending = after;
    }

    // No call or token starts in what is left. Hold the shortest tail that could still begin one.
    const text = this.pending;
    let hold = text.length;
    if (!final) {
      const maxLen = Math.max(...this.triggers.map((t) => t.length));
      for (let i = Math.max(0, text.length - maxLen + 1); i < text.length; i++) {
        const tail = text.slice(i);
        // A name glued to the word before it ("summath") cannot start a call.
        if (i > 0 && /[\w.]/.test(text[i - 1]) && !tail.startsWith("<")) continue;
        if (this.triggers.some((t) => t.startsWith(tail))) { hold = i; break; }
      }
      const partial = PARTIAL_TOKEN_RE.exec(text);
      if (partial && partial.index < hold) hold = partial.index;
    } else {
      // A tail that can only have been the start of a control token is not text.
      const partial = PARTIAL_TOKEN_RE.exec(text);
      if (partial && partial[0].startsWith("<|")) hold = partial.index;
    }
    out += text.slice(0, hold);
    this.pending = final ? "" : text.slice(hold);
    return out;
  }
}
