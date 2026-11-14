// Tool calls a model wrote as reply text (B9 readiness run, 2026-11-13). gemma4 has its own tool-call
// syntax: `<|tool_call>call:name{key:<|"|>value<|"|>,...}<tool_call|>`. Ollama turns that into a real
// tool call only when the whole frame is there. On gemma4:e2b, 4 of 220 chat turns wrote it without the
// opening `<|tool_call>call:`, e.g.
//   progress.mark_mastered{status:<|"|>mastered<|"|>,subtopic_id:<|"|>Division as Sharing<|"|>}<tool_call|>
// Ollama passed it through as plain text, so nothing ran and the child saw the syntax.
//
// ReplyTextFilter sits between the stream and everything the student sees or the app saves. It:
//   - holds back any tail of the stream that could still become such a call (so it never shows
//     mid-stream), and removes the call text once it is complete;
//   - gives up on a call that does not close within HOLD_CAP characters, at a blank line, or by the end
//     of the stream: it then removes only the call's own first line (or less, see abandonAt) and lets
//     the rest through as text, so one stray `name{` never swallows the reply after it;
//   - parses a complete call's arguments strictly (anything this parser does not accept is removed,
//     never guessed at), and hands the kernel at most one call to run (see runsFromText);
//   - drops gemma4's own control tokens (`<tool_call|>`, `<|tool_response>`, ...) and turns its string
//     quote token `<|"|>` into `"`. Text that only looks like a token (`<|y|`, `x<y_z|>`) is kept.
// A call is recognised only by a registered tool's name followed straight by `{`, or after the
// `<|tool_call>` opener. Ordinary prose, code (`list.map{`) and Mermaid (`B{Condition?}`) never match.
//
// Cost: the filter holds at most HOLD_CAP characters plus a short trigger prefix, and each push rescans
// only what it holds, so a reply costs O(length x HOLD_CAP) at worst, O(length) in practice.

import { toolRegistry } from "../tools/registry";

export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

const OPENER = "<|tool_call>";
const CLOSER = "<tool_call|>";
const QUOTE = '<|"|>';
// gemma4's control tokens, exactly. Nothing else that merely looks like one is touched.
const TOKENS = [
  OPENER, CLOSER, QUOTE,
  "<|tool_response>", "<tool_response|>", "<|tool>", "<tool|>",
  "<|turn>", "<turn|>", "<|channel>", "<channel|>", "<|think|>",
];
const TOKEN_RE = new RegExp(TOKENS.map((t) => t.replace(/[|]/g, "\\|")).join("|"));

/** The longest a call may be held unclosed before it is given up on and its text released. */
export const HOLD_CAP = 1500;

/** Tools never run from reply text, however the call is written. Quiz and test scores decide mastery. */
export const NEVER_FROM_TEXT: ReadonlySet<string> = new Set(["progress.mark_mastered"]);

/**
 * Whether a call written as text may run. Never for NEVER_FROM_TEXT. A tool that writes (isReadOnly
 * false) runs only when gemma4's own tool tokens frame the call (`<|tool_call>` before it or
 * `<tool_call|>` after it): bare `name{...}` text can be a note or library passage the model echoed.
 * A read-only tool may run from bare text. `callable` says whether the tool is offered this turn.
 */
export function runsFromText(name: string, framed: boolean, callable: (name: string) => boolean): boolean {
  if (!callable(name) || NEVER_FROM_TEXT.has(name)) return false;
  const tool = toolRegistry.get(name);
  return !!tool && (tool.isReadOnly || framed);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Scan = { end: number } | { open: true } | { broken: true };

/**
 * Where the call whose `{` is at `open` ends. `{ end }` is just past its closing `}`; `{ open }` means
 * the text ran out first; `{ broken }` means it cannot be a call: a blank line outside a string, a
 * line break inside a `"…"` string, or more than HOLD_CAP characters. `<|"|>…<|"|>` and `"…"` strings
 * are skipped, so a brace inside a value does not count.
 */
function scanCall(text: string, open: number): Scan {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (i >= HOLD_CAP) return { broken: true };
    if (text.startsWith(QUOTE, i)) {
      const end = text.indexOf(QUOTE, i + QUOTE.length);
      if (end < 0) return text.length >= HOLD_CAP ? { broken: true } : { open: true };
      i = end + QUOTE.length - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) return { open: true };
      if (text[j] === "\n") return { broken: true };
      i = j;
    } else if (ch === "\n" && text[i + 1] === "\n") return { broken: true };
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return { end: i + 1 };
    }
  }
  return { open: true };
}

/**
 * How much of an unclosed call to remove (`rest` starts with the call, its `{` at `brace`). Only the
 * call's own first line: through the first `}` on it if there is one (a stray quote broke the scan),
 * else the whole line if what follows the `{` reads as arguments, else just `name{` itself.
 */
function abandonAt(rest: string, brace: number): number {
  const nl = rest.indexOf("\n", brace);
  const line = rest.slice(0, nl < 0 ? rest.length : nl);
  let depth = 0;
  for (let i = brace; i < line.length; i++) {
    if (line[i] === "{") depth++;
    else if (line[i] === "}" && --depth === 0) {
      const after = line.slice(i + 1).replace(/^[ \t]*/, "");
      return after.startsWith(CLOSER) ? line.length - after.length + CLOSER.length : i + 1;
    }
  }
  return /^\s*(?:[A-Za-z_][\w-]*\s*:|<\|"\|>|")/.test(line.slice(brace + 1)) ? line.length : brace + 1;
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
 * stream is over (normally or not) and show that too.
 *
 * `toolNames` are the names that mark a call without the `<|tool_call>` opener (every registered tool,
 * so a tool not offered this turn is still removed). `callable(name)` says whether the tool is offered
 * on this request. `calls` holds the one call the kernel should run, if any: the first complete call
 * that parsed and that runsFromText allows. The rest of the stream after it is dropped: a native call
 * ends the model's turn there too, and text written after it ("I saved that card") would claim a result
 * the tool has not produced yet.
 */
export class ReplyTextFilter {
  readonly calls: TextToolCall[] = [];
  private pending = "";
  // The last character released, so a name glued to the word before it ("summath.render{") is not a
  // call even when the two arrive in different chunks.
  private prev = "";
  private stopped = false;
  private readonly callRe: RegExp | null;
  private readonly triggers: string[];
  private readonly maxTrigger: number;

  constructor(toolNames: readonly string[], private readonly callable: (name: string) => boolean = () => false) {
    const names = [...new Set(toolNames)].sort((a, b) => b.length - a.length);
    this.callRe = names.length ? new RegExp(`(?<![\\w.])(?:call:)?(${names.map(escapeRe).join("|")})\\{`, "g") : null;
    this.triggers = [...TOKENS, ...names.flatMap((n) => [`${n}{`, `call:${n}{`])];
    this.maxTrigger = Math.max(...this.triggers.map((t) => t.length));
  }

  /** Whether a call to run was found, so the rest of this stream is being dropped. */
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
    this.pending = "";
    return out;
  }

  private firstCall(text: string): RegExpExecArray | null {
    if (!this.callRe) return null;
    this.callRe.lastIndex = this.prev.length;
    const m = this.callRe.exec(this.prev + text);
    if (m) m.index -= this.prev.length;
    return m;
  }

  private drain(final: boolean): string {
    let out = "";
    const emit = (s: string) => { if (s) { out += s; this.prev = s[s.length - 1]; } };
    for (;;) {
      const text = this.pending;
      const call = this.firstCall(text);
      const token = TOKEN_RE.exec(text);
      const starts = [call?.index, token?.index].filter((n): n is number => n !== undefined);
      if (!starts.length) break;
      const at = Math.min(...starts);
      emit(text.slice(0, at));
      const rest = text.slice(at);

      // The call's name and the index of its `{` in `rest`, or none.
      let name: string | null = null;
      let brace = -1;
      let framed = false;
      if (rest.startsWith(OPENER)) {
        const m = /^<\|tool_call>\s*(?:call:)?([A-Za-z_][\w.]*)\{/.exec(rest);
        if (m) { name = m[1]; brace = m[0].length - 1; framed = true; }
        else if (!final && rest.length < HOLD_CAP && /^<\|tool_call>[\s\w.:]*$/.test(rest)) { this.pending = rest; return out; }
      } else if (call && call.index === at) {
        name = call[1];
        brace = call[0].length - 1;
      }

      if (name === null) {
        // A control token on its own: the quote token reads as a quote, the others as nothing.
        const t = TOKEN_RE.exec(rest)!;
        if (t[0] === QUOTE) emit('"');
        this.pending = rest.slice(t[0].length);
        continue;
      }

      const scan = scanCall(rest, brace);
      if ("open" in scan && !final) { this.pending = rest; return out; }
      if (!("end" in scan)) {
        // Unclosed at the end of the stream, or not a call after all: remove its first line only.
        this.pending = rest.slice(abandonAt(rest, brace));
        continue;
      }
      let after = rest.slice(scan.end);
      const trimmed = after.replace(/^[ \t]*/, "");
      if (trimmed.startsWith(CLOSER)) { after = trimmed.slice(CLOSER.length); framed = true; }
      else if (!final && trimmed.length < CLOSER.length && CLOSER.startsWith(trimmed)) { this.pending = rest; return out; }

      const args = parseGemmaArgs(rest.slice(brace, scan.end));
      if (args && runsFromText(name, framed, this.callable)) {
        this.calls.push({ name, args });
        this.stopped = true;
        this.pending = "";
        return out;
      }
      this.pending = after;
    }

    // No call or token starts in what is left. Find the earliest tail that could still begin one.
    const text = this.pending;
    let tailAt = text.length;
    for (let i = Math.max(0, text.length - this.maxTrigger + 1); i < text.length; i++) {
      const tail = text.slice(i);
      const before = i > 0 ? text[i - 1] : this.prev;
      if (!tail.startsWith("<") && /[\w.]/.test(before)) continue; // glued to a word: not a name
      if (this.triggers.some((t) => t.startsWith(tail))) { tailAt = i; break; }
    }
    if (!final) {
      emit(text.slice(0, tailAt));
      this.pending = text.slice(tailAt);
      return out;
    }
    // End of the stream: a tail that can only have been machinery is dropped, anything else is text
    // ("math", "progress.", "|x|<|y|" stay).
    const tail = text.slice(tailAt);
    const machinery = (tail.startsWith("<|") && TOKENS.some((t) => t.startsWith(tail))) || /\w\.\w|^call:\w/.test(tail);
    emit(machinery ? text.slice(0, tailAt) : text);
    this.pending = "";
    return out;
  }
}

/**
 * A saved tutor reply as the chat shows it: any tool call or control token in it removed, nothing run.
 * Replies saved before the kernel filtered them can still hold the raw syntax.
 */
export function displayReplyText(text: string, toolNames: readonly string[] = toolRegistry.all().map((t) => t.name)): string {
  const filter = new ReplyTextFilter(toolNames);
  return filter.push(text) + filter.end();
}
