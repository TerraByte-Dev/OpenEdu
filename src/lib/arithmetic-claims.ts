// Arithmetic claims code can check without a model — pure, Tauri-free (arithmetic-claims.test.ts).
//
// The notes review on a small model stamped "6 x 7 = 48" and "1/3 is bigger than 1/2" as correct.
// Code can decide those, so it does. Deliberately narrow: two plain numbers and one operator equal a
// third ("6 x 7 = 48", "12 ÷ 4 = 3"), or two numbers or simple fractions compared ("1/3 is bigger than
// 1/2", "0.5 < 0.25"). Anything touching a variable, an exponent, a percent, a negative sign or a
// longer expression is not a claim here, so "2x + 3 = 7" and "10 - 2 x 3 = 4" are left alone.

export interface ArithmeticClaim {
  from: number;
  to: number;
  /** The claim as written in the text. */
  text: string;
  holds: boolean;
  /** What is actually true, in one short sentence. */
  truth: string;
}

const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const OP = "[+\\-−×xX*·÷/]";
// Not glued to a word, a number, or an operator before it ("2x + 3 = 7", "10 - 2 x 3 = 4", "-3 + 5"),
// not the fraction of a mixed number ("1 1/2"), and not scaled by a word ("twice 1/3", "half of 6").
const MODIFIERS = "[Oo]f|[Tt]wice|[Hh]alf|[Dd]ouble|[Tt]riple|[Tt]imes|[Tt]han|[Mm]inus|[Pp]lus|[Oo]ver|[Bb]y|[Aa]nd";
const BEFORE = String.raw`(?<![\w.,$^])(?<![+\-−×*·÷/=<>(]\s*)(?<!\d\s+)(?<!\b(?:${MODIFIERS})\s+)`;
// Not followed by more number, an exponent, a percent, a unit glued on, or more expression.
const AFTER = String.raw`(?![\w.,]?\d)(?![\w^²³%°(/])(?!\s*[+\-−×*·÷/=^<>]\s*[\d(])`;

const EQUATION = new RegExp(`${BEFORE}(${NUM})\\s*(${OP})\\s*(${NUM})\\s*=\\s*(${NUM})${AFTER}`, "g");

const VALUE = String.raw`\d+(?:\.\d+)?(?:\/[1-9]\d*)?`;
const BIGGER = "bigger|greater|larger|more";
const SMALLER = "smaller|less|fewer";
const COMPARISON = new RegExp(
  // "is" is required: in "7 is 3 more than 4" the 3 is a difference, not the thing compared.
  `${BEFORE}(${VALUE})\\s+(?:is|are)\\s+(?:(${BIGGER})|(${SMALLER}))\\s+than\\s+(${VALUE})${AFTER}` +
  // "5 is less than 3 times 2", "1 is smaller than 2 dozen": a multiplier makes it a different claim.
  String.raw`(?!\s+(?:times|of|dozen|hundred|thousand|million|billion|percent|squared|cubed)\b)`,
  "gi",
);
const SYMBOLIC = new RegExp(`${BEFORE}(${VALUE})\\s*([<>])\\s*(${VALUE})${AFTER}`, "g");

const num = (s: string) => Number(s.replace(/,/g, ""));
const decimals = (s: string) => (s.includes(".") ? s.split(".")[1].length : 0);
function value(s: string): number {
  const [n, d] = s.split("/");
  return d === undefined ? Number(n) : Number(n) / Number(d);
}
function show(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : String(Number(n.toFixed(4)));
}
const SYMBOL: Record<string, string> = { "+": "+", "-": "−", "−": "−", x: "×", X: "×", "×": "×", "*": "×", "·": "×", "÷": "÷", "/": "÷" };

function equationClaim(m: RegExpExecArray): ArithmeticClaim | null {
  const [text, a, op, b, c] = m;
  const x = num(a), y = num(b), claimed = num(c);
  let result: number;
  switch (SYMBOL[op]) {
    case "+": result = x + y; break;
    case "−": result = x - y; break;
    case "×": result = x * y; break;
    default:
      if (y === 0) return null;
      result = x / y;
      // "7 ÷ 2 = 3" is often integer division or "3 remainder 1": no verdict when the quotient isn't whole.
      if (!Number.isInteger(result) && decimals(c) === 0) return null;
  }
  // A rounded decimal answer counts when it is right to the places it gives ("1 ÷ 3 = 0.33").
  const places = decimals(c);
  const holds = Math.abs(result - claimed) <= (places ? 0.5 * 10 ** -places : 0) + 1e-9;
  const shown = `${a} ${SYMBOL[op]} ${b}`;
  return {
    from: m.index, to: m.index + text.length, text, holds,
    truth: holds ? `${shown} = ${c}.` : `${shown} = ${show(result)}, not ${c}.`,
  };
}

function compare(m: RegExpExecArray, text: string, a: string, bigger: boolean, b: string): ArithmeticClaim | null {
  const x = value(a), y = value(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const holds = bigger ? x > y : x < y;
  const truth = holds ? `${text}.`
    : x === y ? `${a} and ${b} are equal.`
    : `${a} is ${x > y ? "bigger" : "smaller"} than ${b}.`;
  return { from: m.index, to: m.index + text.length, text, holds, truth };
}

/** Every checkable arithmetic claim in `text`, in order, each saying whether it holds. */
export function arithmeticClaims(text: string): ArithmeticClaim[] {
  const out: ArithmeticClaim[] = [];
  for (const m of text.matchAll(EQUATION)) {
    const c = equationClaim(m as RegExpExecArray);
    if (c) out.push(c);
  }
  for (const m of text.matchAll(COMPARISON)) {
    const c = compare(m as RegExpExecArray, m[0], m[1], m[2] !== undefined, m[4]);
    if (c) out.push(c);
  }
  for (const m of text.matchAll(SYMBOLIC)) {
    const c = compare(m as RegExpExecArray, m[0], m[1], m[2] === ">", m[3]);
    if (c) out.push(c);
  }
  return out.sort((p, q) => p.from - q.from);
}
