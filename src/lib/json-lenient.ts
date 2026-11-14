// Lenient JSON parsing for model output, moved out of llm.ts so Tauri-free modules can use it
// (llm.ts imports @tauri-apps/plugin-http).

// Small Ollama models often emit raw LaTeX (\alpha, \frac, \pi, \sum, \underline, ...) inside
// JSON string values without doubling the backslash. JSON.parse rejects those as
// "Bad escaped character". Double any backslash that doesn't start a valid JSON escape. A valid
// escape (including an already-doubled `\\`) is consumed whole, so `\\alpha` stays `\\alpha`, and
// `\u` only counts as an escape when four hex digits follow it.
export function sanitizeJsonEscapes(s: string): string {
  return s.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (m, esc: string | undefined) => (esc ? m : "\\\\"));
}

// Try JSON.parse, with a stray-backslash repair retry as a fallback.
export function tryParseJsonLenient(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return JSON.parse(sanitizeJsonEscapes(raw)); }
}

// ─── LaTeX commands that JSON escapes turned into control characters ─────────────────────────────
// The other half of the problem above: `\text`, `\times`, `\frac`, `\begin`, `\right`, `\nabla` start
// with a VALID JSON escape (\t \f \b \r \n), so JSON.parse succeeds and the child sees `2<TAB>ext{πr}`.
// Seen on gemma4:e2b in note summaries, a note review and quiz questions. Repaired after parsing.
//
// Conservative on purpose. Real tabs and newlines are common in model text; a repair happens only when
// the letters right after the control character, up to the next non-letter, spell a known LaTeX
// command. Form feed and backspace never belong in a child's text, so any letters after them count.
// Names whose tail is also a plausible English word (\to, \tan, \nu, \neq, \rho ...) are repaired only
// when the string already shows LaTeX elsewhere, the character before is not line punctuation, and a
// space before it sits inside $...$.

const CONTROL_TO_ESCAPE: Record<string, string> = { "\t": "t", "\f": "f", "\b": "b", "\r": "r", "\n": "n" };

const LATEX_COMMANDS = new Set([
  // \t
  "text", "textbf", "textit", "textrm", "texttt", "textsf", "textnormal", "textstyle",
  "times", "theta", "therefore", "triangle", "tfrac", "tilde",
  // \r
  "right", "rightarrow", "rangle", "rfloor", "rceil", "rbrace", "rvert",
  // \n
  "nabla", "newline", "notin", "nleq", "ngeq", "nmid",
]);

// The tail after the escape letter reads as a word or a line start ("o", "an", "u", "eq", "ho").
const AMBIGUOUS_COMMANDS = new Set(["to", "tan", "tanh", "tau", "top", "nu", "neq", "ne", "rho", "rm"]);

// The run of letters starting at `from` ("" when there is none). Sticky, so no copy of the tail.
const LETTERS = /[A-Za-z]+/y;
function lettersAt(s: string, from: number): string {
  LETTERS.lastIndex = from;
  return LETTERS.exec(s)?.[0] ?? "";
}

function hasMathSignal(s: string): boolean {
  if (s.includes("$") || s.includes("\\")) return true;
  // Another, unambiguous mangled command in the same string.
  for (let i = 0; i < s.length; i++) {
    const esc = CONTROL_TO_ESCAPE[s[i]];
    if (!esc) continue;
    const run = lettersAt(s, i + 1);
    if (!run) continue;
    if (esc === "f" || esc === "b" || LATEX_COMMANDS.has(esc + run)) return true;
  }
  return false;
}

function insideDollars(s: string, at: number): boolean {
  let n = 0;
  for (let i = 0; i < at; i++) if (s[i] === "$") n++;
  return n % 2 === 1;
}

/** Restore the backslash in LaTeX commands that a JSON escape turned into a control character. */
export function repairLatexControlChars(s: string): string {
  if (!/[\t\f\b\r\n]/.test(s)) return s;
  let mathSignal: boolean | undefined;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const esc = CONTROL_TO_ESCAPE[ch];
    const run = esc ? lettersAt(s, i + 1) : "";
    if (!esc || !run) { out += ch; continue; }

    const name = esc + run;
    let repair = esc === "f" || esc === "b" || LATEX_COMMANDS.has(name);
    if (!repair && AMBIGUOUS_COMMANDS.has(name)) {
      const prev = s[i - 1];
      mathSignal ??= hasMathSignal(s);
      // A space before is normal inside `$a \neq b$`, and normal before a real line break too, so a
      // space counts only inside $...$ (an odd number of `$` so far).
      repair = mathSignal && prev !== undefined && !/[\t\n\r.!?:;]/.test(prev) &&
        (prev !== " " || insideDollars(s, i));
    }
    out += repair ? "\\" + esc : ch;
  }
  return out;
}

/** repairLatexControlChars applied to every string value in a parsed JSON value. Keys are left alone. */
export function repairLatexInValue<T>(value: T): T {
  if (typeof value === "string") return repairLatexControlChars(value) as T;
  if (Array.isArray(value)) return value.map((v) => repairLatexInValue(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = repairLatexInValue(v);
    return out as T;
  }
  return value;
}
