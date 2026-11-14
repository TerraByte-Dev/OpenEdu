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
//   - gives up on a call that does not close (see giveUp): text that was inside one of the call's
//     strings is never released, and otherwise only the call's own first line is removed, so one
//     stray `name{` never swallows the reply after it;
//   - parses a complete call's arguments strictly (anything this parser does not accept is removed,
//     never guessed at), and hands the kernel at most one call to run (see runsFromText);
//   - drops gemma4's own control tokens (`<tool_call|>`, `<|tool_response>`, ...) and turns its string
//     quote token `<|"|>` into `"`. Text that only looks like a token (`<|y|`, `x<y_z|>`) is kept.
// A call is recognised only by a registered tool's name followed straight by `{`, or after the
// `<|tool_call>` opener, and never inside an open ``` code fence. Ordinary prose, code (`list.map{`)
// and Mermaid (`B{Condition?}`) never match.
//
// Cost: a held call is scanned incrementally (each character once), so a reply costs O(length).

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

/** Characters a call may hold OUTSIDE its strings before it is given up on. */
export const HOLD_CAP = 1500;
/** Characters a call may hold in all, string bodies included (a long Mermaid source is fine). */
export const STRING_CAP = 20000;

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

// ── Code fences in the text already released ──
// A call inside an open ``` or ~~~ fence is code the model is showing, not a call.
interface FenceState {
  fence: string | null; // the open fence's marker ("```", "~~~~"), or null
  line: string;         // the current line so far (its first characters are enough)
}
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function fenceAfter(state: FenceState, text: string): FenceState {
  let { fence, line } = state;
  const parts = text.split("\n");
  for (let i = 0; i < parts.length - 1; i++) {
    const full = line + parts[i];
    line = "";
    const m = FENCE_LINE.exec(full);
    if (!m) continue;
    if (fence === null) {
      if (!(m[1][0] === "`" && m[2].includes("`"))) fence = m[1];
    } else if (m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null;
  }
  line = (line + parts[parts.length - 1]).slice(0, 64);
  return { fence, line };
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

// A call being held. `pending` starts with it. The scan state lets each push scan only new text.
interface Held {
  name: string;
  brace: number;            // index of its `{` in pending
  framed: boolean;
  pos: number;              // next index to scan
  depth: number;
  str: null | "gemma" | "json";
  strAt: number;            // where the open string started
  lastStrEnd: number;       // just past the last string that closed: text before it is never released
  outside: number;          // characters scanned outside strings
  end: number;              // just past the closing `}`, or -1
  broken: boolean;          // a blank line outside a string or inside a "…" string, or a cap
}

// What the names compile to, shared by every filter with the same tool list.
interface Compiled { callRe: RegExp | null; triggers: string[]; maxTrigger: number }
const compiledCache = new Map<string, Compiled>();
function compile(toolNames: readonly string[]): Compiled {
  const names = [...new Set(toolNames)].sort((a, b) => b.length - a.length);
  const key = names.join("\n");
  let c = compiledCache.get(key);
  if (!c) {
    const triggers = [...TOKENS, ...names.flatMap((n) => [`${n}{`, `call:${n}{`])];
    c = {
      callRe: names.length ? new RegExp(`(?<![\\w.])(?:call:)?(${names.map(escapeRe).join("|")})\\{`, "g") : null,
      triggers,
      maxTrigger: Math.max(...triggers.map((t) => t.length)),
    };
    compiledCache.set(key, c);
  }
  return c;
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
  private fence: FenceState = { fence: null, line: "" };
  private held: Held | null = null;
  // After giving up inside a string past STRING_CAP: what follows is still that string, so it is dropped
  // to the end of the stream.
  private discarding = false;
  private stopped = false;
  private readonly c: Compiled;

  constructor(toolNames: readonly string[], private readonly callable: (name: string) => boolean = () => false) {
    this.c = compile(toolNames);
  }

  /** Whether a call to run was found, so the rest of this stream is being dropped. */
  get stoppedAtCall(): boolean {
    return this.stopped;
  }

  push(delta: string): string {
    if (this.stopped || this.discarding) return "";
    this.pending += delta;
    return this.drain(false);
  }

  end(): string {
    if (this.stopped || this.discarding) return "";
    const out = this.drain(true);
    this.pending = "";
    this.held = null;
    return out;
  }

  // The first call in `text` that is not glued to a word and not inside an open code fence.
  private firstCall(text: string): RegExpExecArray | null {
    const re = this.c.callRe;
    if (!re) return null;
    const src = this.prev + text;
    re.lastIndex = this.prev.length;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const at = m.index - this.prev.length;
      if (fenceAfter(this.fence, text.slice(0, at)).fence === null) { m.index = at; return m; }
      re.lastIndex = m.index + 1;
    }
    return null;
  }

  // Scan the held call from where the last push stopped.
  private advance(h: Held): void {
    const t = this.pending;
    let i = h.pos;
    while (i < t.length && h.end < 0 && !h.broken) {
      if (t.length > STRING_CAP) { h.broken = true; break; }
      if (h.str === "gemma") {
        const close = t.indexOf(QUOTE, i);
        if (close < 0) { i = Math.max(i, t.length - QUOTE.length + 1); break; }
        h.str = null;
        i = close + QUOTE.length;
        h.lastStrEnd = i;
        continue;
      }
      const ch = t[i];
      if (h.str === "json") {
        if (ch === "\\") { if (i + 1 >= t.length) break; i += 2; continue; }
        if (ch === '"') { h.str = null; i++; h.lastStrEnd = i; continue; }
        if (ch === "\n") {
          if (i + 1 >= t.length) break;
          if (t[i + 1] === "\n") { h.broken = true; break; }
        }
        i++;
        continue;
      }
      // Outside a string.
      if (ch === "<" && QUOTE.startsWith(t.slice(i, i + QUOTE.length)) && t.length - i < QUOTE.length) break;
      if (t.startsWith(QUOTE, i)) { h.str = "gemma"; h.strAt = i; i += QUOTE.length; continue; }
      if (ch === '"') { h.str = "json"; h.strAt = i; i++; continue; }
      if (ch === "\n") {
        if (i + 1 >= t.length) break;
        if (t[i + 1] === "\n") { h.broken = true; break; }
      }
      if (++h.outside > HOLD_CAP) { h.broken = true; break; }
      if (ch === "{" || ch === "[") h.depth++;
      else if ((ch === "}" || ch === "]") && --h.depth === 0) { h.end = i + 1; break; }
      i++;
    }
    h.pos = i;
  }

  /**
   * Remove an unclosed call and return what to keep scanning. Text inside a string is never released:
   * an unclosed `<|"|>` string runs to the end of the stream, and an unclosed `"` string to the blank
   * line that ended it, unless a `}` closes the call on its first line (a stray quote: `{x:"y} Well
   * done.`). Outside a string, only the call's first line goes: through a `}` on it, the whole line when
   * what follows the `{` reads as arguments, or just `name{`; never less than every string that closed.
   */
  private giveUp(h: Held, final: boolean): void {
    const rest = this.pending;
    const nl = rest.indexOf("\n", h.brace);
    const line = rest.slice(0, nl < 0 ? rest.length : nl);
    let firstLineClose = -1;
    for (let i = h.brace, depth = 0; i < line.length; i++) {
      if (line[i] === "{") depth++;
      else if (line[i] === "}" && --depth === 0) { firstLineClose = i + 1; break; }
    }
    let cut: number;
    if (h.str === "gemma") {
      cut = rest.length;
      if (!final) this.discarding = true;
    } else if (h.str === "json" && !(firstLineClose > h.strAt)) {
      const blank = rest.indexOf("\n\n", h.strAt);
      cut = blank >= 0 ? blank : rest.length;
      if (blank < 0 && !final) this.discarding = true;
    } else {
      if (firstLineClose >= 0) {
        const after = line.slice(firstLineClose).replace(/^[ \t]*/, "");
        cut = after.startsWith(CLOSER) ? line.length - after.length + CLOSER.length : firstLineClose;
      } else {
        cut = /^\s*(?:[A-Za-z_][\w-]*\s*:|<\|"\|>|")/.test(line.slice(h.brace + 1)) ? line.length : h.brace + 1;
      }
      cut = Math.max(cut, h.lastStrEnd);
    }
    this.pending = rest.slice(cut);
    this.held = null;
  }

  private drain(final: boolean): string {
    let out = "";
    const emit = (s: string) => {
      if (!s) return;
      out += s;
      this.prev = s[s.length - 1];
      this.fence = fenceAfter(this.fence, s);
    };
    for (;;) {
      if (this.discarding) { this.pending = ""; return out; }
      const h = this.held;
      if (h) {
        this.advance(h);
        if (h.end < 0 && !h.broken) {
          if (!final) return out;
          this.giveUp(h, true);
          continue;
        }
        if (h.broken) { this.giveUp(h, final); continue; }
        const rest = this.pending;
        let after = rest.slice(h.end);
        const trimmed = after.replace(/^[ \t]*/, "");
        let framed = h.framed;
        if (trimmed.startsWith(CLOSER)) { after = trimmed.slice(CLOSER.length); framed = true; }
        else if (!final && trimmed.length < CLOSER.length && CLOSER.startsWith(trimmed)) return out;
        this.held = null;
        const args = parseGemmaArgs(rest.slice(h.brace, h.end));
        if (args && runsFromText(h.name, framed, this.callable)) {
          this.calls.push({ name: h.name, args });
          this.stopped = true;
          this.pending = "";
          return out;
        }
        this.pending = after;
        continue;
      }

      const text = this.pending;
      const call = this.firstCall(text);
      const token = TOKEN_RE.exec(text);
      const starts = [call?.index, token?.index].filter((n): n is number => n !== undefined);
      if (!starts.length) break;
      const at = Math.min(...starts);
      emit(text.slice(0, at));
      const rest = text.slice(at);

      let name: string | null = null;
      let brace = -1;
      let framed = false;
      if (rest.startsWith(OPENER) && this.fence.fence === null) {
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
      this.pending = rest;
      this.held = { name, brace, framed, pos: brace, depth: 0, str: null, strAt: -1, lastStrEnd: 0, outside: 0, end: -1, broken: false };
    }

    // No call or token starts in what is left. Find the earliest tail that could still begin one.
    const text = this.pending;
    let tailAt = text.length;
    for (let i = Math.max(0, text.length - this.c.maxTrigger + 1); i < text.length; i++) {
      const tail = text.slice(i);
      const before = i > 0 ? text[i - 1] : this.prev;
      if (!tail.startsWith("<") && /[\w.]/.test(before)) continue; // glued to a word: not a name
      if (this.c.triggers.some((t) => t.startsWith(tail))) { tailAt = i; break; }
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
 * A saved tutor reply as the chat shows it and reads it aloud: any tool call or control token in it
 * removed, nothing run. Replies saved before the kernel filtered them can still hold the raw syntax.
 */
export function displayReplyText(text: string, toolNames: readonly string[] = toolRegistry.all().map((t) => t.name)): string {
  const filter = new ReplyTextFilter(toolNames);
  return filter.push(text) + filter.end();
}
