// Read-aloud text (#243): a tutor reply's markdown as the plain words a speech voice should say, and
// the choice of voice. Pure (no DOM): speech.test.ts covers it, and ChatTab's speaker button and the
// K-2 auto-read call it unchanged through useReadAloud.ts, the thin window.speechSynthesis shell.
//
// The reply is tokenized by marked with the same math extension the chat renderer uses
// (chat-math.ts), so what is spoken is what is shown: a "$5" the renderer leaves as prose is read as
// prose, and an equation it typesets is read as an equation. Markdown syntax is never spoken, a code
// block is spoken as one word, and LaTeX becomes words ("x squared plus 1 over 2"). No backslash, no
// brace and no dollar delimiter reaches the voice.

import { Marked, type Token } from "marked";
import { chatMathExtension } from "./chat-math";
import { fenceBareMermaid } from "./mermaid-source";

/** What a fenced or indented code block is read as. */
export const CODE_SPOKEN = "Code";
/** What a ```mermaid fence is read as: the chat draws it as a picture (mermaid-source.ts), not code. */
export const DRAWING_SPOKEN = "A drawing";
/** What math that cannot be read as words (a matrix, an aligned block) is read as. */
export const MATH_PLACEHOLDER = "a math expression";

// Tokenizing only: the renderer callback is never reached, so no KaTeX.
const speechMarked = new Marked({ gfm: true, breaks: true }).use(chatMathExtension(() => null));

// ── LaTeX → words ────────────────────────────────────────────────────────────────────────────────

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota",
  "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi",
  "psi", "omega",
];

const COMMAND_WORDS: Record<string, string> = {
  times: "times", cdot: "times", ast: "times", div: "divided by",
  pm: "plus or minus", mp: "minus or plus",
  le: "is less than or equal to", leq: "is less than or equal to", leqslant: "is less than or equal to",
  ge: "is greater than or equal to", geq: "is greater than or equal to", geqslant: "is greater than or equal to",
  lt: "is less than", gt: "is greater than", ne: "is not equal to", neq: "is not equal to",
  approx: "is about", sim: "is about", equiv: "is equivalent to", propto: "is proportional to",
  infty: "infinity", to: "to", rightarrow: "gives", longrightarrow: "gives", leftarrow: "from",
  Rightarrow: "so", implies: "so", iff: "if and only if", therefore: "therefore", because: "because",
  circ: "degrees", degree: "degrees", prime: "prime",
  cdots: "and so on", ldots: "and so on", dots: "and so on",
  sum: "the sum of", prod: "the product of", int: "the integral of", lim: "the limit",
  sin: "sine", cos: "cosine", tan: "tangent", log: "log", ln: "natural log", exp: "e to the",
  in: "in", notin: "not in", subset: "subset of", cup: "union", cap: "intersection",
  angle: "angle", triangle: "triangle", parallel: "is parallel to", perp: "is perpendicular to",
  partial: "partial", nabla: "del", emptyset: "the empty set", neg: "not", land: "and", lor: "or",
};

// Commands that only change spacing or size: read as nothing.
const SILENT = new Set([
  "left", "right", "big", "Big", "bigg", "Bigg", "displaystyle", "textstyle", "limits", "nolimits",
  "quad", "qquad", "hfill", "middle",
]);

// Commands whose one argument is read as is: fonts and wrappers.
const WRAPPERS = new Set([
  "mathrm", "mathbf", "mathit", "mathsf", "mathbb", "mathcal", "boldsymbol", "operatorname",
  "overline", "underline", "bar", "hat", "tilde", "widehat", "widetilde", "dot", "ddot", "boxed",
]);
const TEXT_WRAPPERS = new Set(["text", "textrm", "textbf", "textit", "textsf", "mbox"]);

class TexReader {
  i = 0;
  constructor(private readonly s: string) {}

  done(): boolean { return this.i >= this.s.length; }

  skipSpace(): void { while (/\s/.test(this.s[this.i] ?? "")) this.i++; }

  // The raw source of the next argument: a {group}'s inside, a \command, or one character.
  argSource(): string {
    this.skipSpace();
    const ch = this.s[this.i];
    if (ch === undefined) return "";
    if (ch === "{") return this.group();
    if (ch === "\\") {
      const start = this.i++;
      if (/[A-Za-z]/.test(this.s[this.i] ?? "")) while (/[A-Za-z]/.test(this.s[this.i] ?? "")) this.i++;
      else this.i++;
      return this.s.slice(start, this.i);
    }
    this.i++;
    return ch;
  }

  // At a "{": the text up to its matching "}", which is consumed.
  group(): string {
    let depth = 0;
    const start = this.i + 1;
    for (; this.i < this.s.length; this.i++) {
      const ch = this.s[this.i];
      if (ch === "\\") { this.i++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { this.i++; return this.s.slice(start, this.i - 1); }
    }
    return this.s.slice(start);
  }

  optional(): string | null {
    this.skipSpace();
    if (this.s[this.i] !== "[") return null;
    const end = this.s.indexOf("]", this.i);
    if (end < 0) return null;
    const v = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return v;
  }
}

function ordinal(n: string): string {
  if (n === "3") return "cube";
  if (!/^\d+$/.test(n)) return `${texWords(n)}th`;
  const last = n.slice(-1);
  const teen = n.length > 1 && n[n.length - 2] === "1";
  return n + (teen ? "th" : last === "1" ? "st" : last === "2" ? "nd" : last === "3" ? "rd" : "th");
}

function power(arg: string): string {
  const a = arg.trim();
  if (a === "2") return " squared ";
  if (a === "3") return " cubed ";
  if (a === "\\circ") return " degrees ";
  if (a === "\\prime" || a === "'") return " prime ";
  return ` to the power of ${texWords(a)} `;
}

function command(name: string, r: TexReader): string {
  if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
    const num = texWords(r.argSource());
    return ` ${num} over ${texWords(r.argSource())} `;
  }
  if (name === "binom") {
    const n = texWords(r.argSource());
    return ` ${n} choose ${texWords(r.argSource())} `;
  }
  if (name === "sqrt") {
    const index = r.optional();
    const body = texWords(r.argSource());
    return index && index.trim() !== "2" ? ` the ${ordinal(index.trim())} root of ${body} ` : ` the square root of ${body} `;
  }
  if (name === "vec") return ` vector ${texWords(r.argSource())} `;
  // Chemistry (\ce{2H2 + O2 -> 2H2O}): formulas are read as written, arrows and + as words.
  if (name === "ce") return ` ${r.argSource().replace(/<?->|→/g, " gives ").replace(/\+/g, " plus ").replace(/[{}\\^_]/g, " ")} `;
  if (TEXT_WRAPPERS.has(name)) return ` ${r.argSource().replace(/[{}\\]/g, " ")} `;
  if (WRAPPERS.has(name)) return ` ${texWords(r.argSource())} `;
  if (SILENT.has(name)) return " ";
  if (COMMAND_WORDS[name]) return ` ${COMMAND_WORDS[name]} `;
  const greek = name.toLowerCase();
  if (GREEK.includes(greek)) return ` ${greek.replace(/^var/, "")} `;
  // An unknown command is read as its name (\sinh → "sinh"), never as a backslash.
  return ` ${name} `;
}

const SYMBOL_WORDS: Record<string, string> = {
  "=": " equals ", "+": " plus ", "-": " minus ", "*": " times ", "/": " over ", "<": " is less than ",
  ">": " is greater than ", "!": " factorial ", ":": " to ", "'": " prime ", ",": ", ", ";": ", ",
};

/** A LaTeX expression as words. Never contains a backslash, a brace, or a $. */
export function texWords(tex: string): string {
  const src = tex.replace(/\\begin\{([A-Za-z*]+)\}[\s\S]*?\\end\{\1\}/g, ` ${MATH_PLACEHOLDER} `);
  const r = new TexReader(src);
  let out = "";
  while (!r.done()) {
    const ch = src[r.i];
    if (ch === "\\") {
      r.i++;
      const next = src[r.i] ?? "";
      if (/[A-Za-z]/.test(next)) {
        const start = r.i;
        while (/[A-Za-z]/.test(src[r.i] ?? "")) r.i++;
        out += command(src.slice(start, r.i), r);
      } else {
        r.i++;
        out += next === "%" ? " percent " : next === "$" ? " dollars " : next === "&" ? " and " : next === "\\" ? ", " : " ";
      }
    } else if (ch === "{") {
      out += ` ${texWords(r.group())} `;
    } else if (ch === "^") {
      r.i++;
      out += power(r.argSource());
    } else if (ch === "_") {
      r.i++;
      out += ` sub ${texWords(r.argSource())} `;
    } else if (SYMBOL_WORDS[ch]) {
      r.i++;
      out += SYMBOL_WORDS[ch];
    } else if ("}()[]|&~$".includes(ch)) {
      r.i++;
      out += " ";
    } else {
      r.i++;
      out += ch;
    }
  }
  const words = out.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "");
  return words || MATH_PLACEHOLDER;
}

// ── Markdown → words ─────────────────────────────────────────────────────────────────────────────

// A line break inside a block. Turned into a sentence end later, so "Step 1: add\nStep 2: carry"
// pauses between the steps.
const BREAK = "\n";

type AnyToken = Token & { tokens?: Token[]; text?: string; lang?: string };

function inline(tokens: ReadonlyArray<Token> | undefined): string {
  if (!tokens) return "";
  return tokens.map((tok) => {
    const t = tok as AnyToken;
    switch (t.type) {
      case "inlineMath":
      case "blockMath":
        return ` ${texWords(t.text ?? "")} `;
      case "codespan":
        return t.text ?? "";
      case "br":
        return BREAK;
      case "image":
        return t.text ?? "";
      case "html":
      case "checkbox":
        return "";
      default:
        return t.tokens ? inline(t.tokens) : (t.text ?? "");
    }
  }).join("");
}

function blocks(tokens: ReadonlyArray<Token>): string[] {
  const out: string[] = [];
  for (const tok of tokens) {
    const t = tok as AnyToken;
    switch (t.type) {
      case "code":
        out.push((t.lang ?? "").trim().split(/\s+/)[0].toLowerCase() === "mermaid" ? DRAWING_SPOKEN : CODE_SPOKEN);
        break;
      case "blockMath":
        out.push(texWords(t.text ?? ""));
        break;
      case "list":
        for (const item of (t as Token & { items: Token[] }).items) out.push(...blocks((item as AnyToken).tokens ?? []));
        break;
      case "blockquote":
        out.push(...blocks(t.tokens ?? []));
        break;
      case "table": {
        const tbl = t as Token & { header: Array<{ tokens: Token[] }>; rows: Array<Array<{ tokens: Token[] }>> };
        for (const row of [tbl.header, ...tbl.rows]) out.push(row.map((c) => inline(c.tokens)).join(", "));
        break;
      }
      case "space":
      case "hr":
      case "html":
      case "def":
        break;
      default:
        out.push(t.tokens ? inline(t.tokens) : (t.text ?? ""));
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };

function sentence(raw: string): string {
  const s = raw
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
    .replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, " ")
    .replace(/[️‍]/g, "")
    // Markdown syntax marked left in the text (an unmatched * or _, a bracketed note) and any
    // backslash: none of it is a word.
    .replace(/[*_`#~|[\]{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
  if (!s) return "";
  return /[.!?:;]$/.test(s) ? s : `${s}.`;
}

/**
 * A tutor reply (markdown, as saved) as the text to speak: no markdown symbols, no raw LaTeX, code
 * blocks as one word. Empty when there is nothing to say.
 */
export function speakableText(markdown: string): string {
  // Mermaid written with no fence is read as the fenced diagram the chat draws (mermaid-source.ts).
  const parts = blocks(speechMarked.lexer(fenceBareMermaid(markdown)));
  return parts.flatMap((p) => p.split(BREAK)).map(sentence).filter(Boolean).join(" ");
}

// ── Voice choice ─────────────────────────────────────────────────────────────────────────────────

/** The fields of SpeechSynthesisVoice the choice reads. */
export interface VoiceLike {
  lang: string;
  localService: boolean;
  default?: boolean;
}

const langKey = (l: string) => l.trim().replace(/_/g, "-").toLowerCase();

/**
 * The voice to read with, or null to leave the system default. Only on-device voices
 * (localService) are chosen, because an online voice says nothing with the network unplugged. In
 * order: the UI language exactly (en-US), then its language (en-*), then any English voice. Within
 * a rank the system default voice wins, then list order.
 */
export function pickVoice<V extends VoiceLike>(voices: ReadonlyArray<V>, uiLang: string): V | null {
  const ui = langKey(uiLang || "en");
  const primary = ui.split("-")[0];
  const rank = (v: V): number => {
    if (!v.localService) return 0;
    const l = langKey(v.lang);
    if (l === ui) return 3;
    if (l.split("-")[0] === primary) return 2;
    if (l.split("-")[0] === "en") return 1;
    return 0;
  };
  let best: V | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const score = rank(v) * 2 + (v.default ? 1 : 0);
    if (rank(v) > 0 && score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}
