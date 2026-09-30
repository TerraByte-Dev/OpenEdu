// Deterministic arithmetic for math.calculate (#130). A 0.8B model can't be trusted to multiply, so
// numbers in math answers come from here and the model only phrases over them. The expression is
// model-written, so it is untrusted input: a hand-rolled tokenizer + recursive-descent evaluator over
// a fixed whitelist. No eval, no Function, and names resolve through Maps, never object properties,
// so "constructor" or "__proto__" is just an unknown name.
//
// Grammar (lowest to highest precedence):
//   expr    = term (("+" | "-") term)*
//   term    = unary (("*" | "/") unary)*
//   unary   = ("-" | "+") unary | power
//   power   = primary ("^" unary)?          right-associative: 2^3^2 = 2^9
//   primary = number | constant | function "(" expr ")" | "(" expr ")"
// Unary minus binds looser than ^, as in written math: -2^2 = -(2^2) = -4, and 2^-1 = 0.5.

export type CalcResult =
  | { ok: true; value: number; normalized: string; display: string }
  | { ok: false; error: string };

const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E],
]);

// Trig takes radians.
const FUNCTIONS = new Map<string, (x: number) => number>([
  ["sqrt", Math.sqrt],
  ["abs", Math.abs],
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
  ["ln", Math.log],
  ["log10", Math.log10],
  ["round", Math.round],
]);

const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

type Token = { kind: "num"; text: string; value: number } | { kind: "name"; text: string } | { kind: "op"; text: string };

class CalcError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ kind: "num", text: num[0], value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) {
      tokens.push({ kind: "name", text: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      tokens.push({ kind: "op", text: ch });
      i++;
      continue;
    }
    throw new CalcError(`unsupported character "${ch}" — use + - * / ^ and parentheses`);
  }
  return tokens;
}

function parse(tokens: Token[]): number {
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (text: string) => peek()?.kind === "op" && peek()!.text === text;

  const nested = <T>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new CalcError("expression is nested too deeply");
    try { return fn(); } finally { depth--; }
  };

  function expr(): number {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].text;
      const right = term();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function term(): number {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].text;
      const right = unary();
      if (op === "/" && right === 0) throw new CalcError("division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function unary(): number {
    return nested(() => {
      if (isOp("-")) { pos++; return -unary(); }
      if (isOp("+")) { pos++; return unary(); }
      return power();
    });
  }

  function power(): number {
    const base = primary();
    if (!isOp("^")) return base;
    pos++;
    return base ** unary();
  }

  function primary(): number {
    const tok = peek();
    if (!tok) throw new CalcError("expression ends too early");
    if (tok.kind === "num") {
      pos++;
      return tok.value;
    }
    if (tok.kind === "name") {
      pos++;
      const fn = FUNCTIONS.get(tok.text);
      if (fn) {
        if (!isOp("(")) throw new CalcError(`${tok.text} needs parentheses, e.g. ${tok.text}(2)`);
        pos++;
        const arg = nested(expr);
        if (!isOp(")")) throw new CalcError("missing closing parenthesis");
        pos++;
        return fn(arg);
      }
      const constant = CONSTANTS.get(tok.text);
      if (constant !== undefined) return constant;
      throw new CalcError(`unknown name "${tok.text}" — allowed: ${[...CONSTANTS.keys(), ...FUNCTIONS.keys()].join(", ")}`);
    }
    if (tok.text === "(") {
      pos++;
      const inner = nested(expr);
      if (!isOp(")")) throw new CalcError("missing closing parenthesis");
      pos++;
      return inner;
    }
    if (tok.text === ")") throw new CalcError("unexpected closing parenthesis");
    throw new CalcError(`expected a number before "${tok.text}"`);
  }

  const value = expr();
  if (pos < tokens.length) {
    const tok = tokens[pos];
    throw new CalcError(tok.text === ")" ? "unexpected closing parenthesis" : `missing operator before "${tok.text}"`);
  }
  return value;
}

// Up to 15 significant digits with trailing zeros trimmed, so 0.1+0.2 shows as 0.3 but 12345678901
// isn't rounded (the model only sees `display`); `value` keeps the exact double.
export function formatNumber(value: number): string {
  const n = Number(value.toPrecision(15));
  return Object.is(n, -0) ? "0" : String(n);
}

export function calculate(expression: string): CalcResult {
  try {
    const src = expression.trim();
    if (!src) throw new CalcError("expression is empty");
    if (src.length > MAX_LENGTH) throw new CalcError(`expression is longer than ${MAX_LENGTH} characters`);
    const tokens = tokenize(src);
    const value = parse(tokens);
    if (!Number.isFinite(value)) throw new CalcError("result is not a finite number (e.g. sqrt of a negative, ln(0), or an overflow)");
    return { ok: true, value, normalized: tokens.map((t) => t.text).join(""), display: formatNumber(value) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message };
    return { ok: false, error: `could not evaluate: ${e instanceof Error ? e.message : String(e)}` };
  }
}
