import { describe, it, expect } from "vitest";
import { calculate, formatNumber } from "./calc";

const value = (expr: string) => {
  const r = calculate(expr);
  if (!r.ok) throw new Error(`${expr}: ${r.error}`);
  return r.value;
};

describe("calculate", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3], // left-associative
    ["100 / 10 / 5", 2],
    ["2^3^2", 512], // right-associative: 2^(3^2)
    ["-2^2", -4], // unary minus binds looser than ^, as in written math
    ["(-2)^2", 4],
    ["2^-1", 0.5],
    ["--3", 3],
    ["+4", 4],
    ["150 / 2.5", 60],
    ["12*5/1.5", 40],
    [".5 + 1.", 1.5],
    ["1.5e3", 1500],
    ["2E-3", 0.002],
    ["sqrt(16)", 4],
    ["abs(-3.5)", 3.5],
    ["round(2.5)", 3],
    ["log10(1000)", 3],
    ["ln(e)", 1],
    ["sin(0) + cos(0)", 1],
    ["tan(0)", 0],
    ["2 * pi", 2 * Math.PI],
    ["PI", Math.PI], // names are case-insensitive
    ["sqrt(3^2 + 4^2)", 5],
  ])("%s = %s", (expr, expected) => {
    expect(value(expr)).toBeCloseTo(expected, 12);
  });

  it.each([
    ["", "expression is empty"],
    ["   ", "expression is empty"],
    ["(1 + 2", "missing closing parenthesis"],
    ["1 + 2)", "unexpected closing parenthesis"],
    [")", "unexpected closing parenthesis"],
    ["1 +", "expression ends too early"],
    ["* 2", 'expected a number before "*"'],
    ["2 3", 'missing operator before "3"'],
    ["2(3)", 'missing operator before "("'],
    ["1/0", "division by zero"],
    ["1/(2-2)", "division by zero"],
    ["sqrt(-1)", "result is not a finite number"],
    ["ln(0)", "result is not a finite number"],
    ["10^400", "result is not a finite number"],
    ["sqrt 4", "sqrt needs parentheses"],
    ["x + 1", 'unknown name "x"'],
    ["constructor", 'unknown name "constructor"'],
    ["__proto__", 'unknown name "__proto__"'],
    ["toString(1)", 'unknown name "tostring"'],
    ["process.exit()", 'unsupported character "."'],
    ["alert`1`", 'unsupported character "`"'],
    ["2 × 3", 'unsupported character "×"'],
    ["1,000", 'unsupported character ","'],
  ])("rejects %j", (expr, message) => {
    const r = calculate(expr);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it("rejects runaway nesting and length instead of overflowing the stack", () => {
    const deep = "(".repeat(200) + "1" + ")".repeat(200);
    expect(calculate(deep)).toEqual({ ok: false, error: "expression is nested too deeply" });
    expect(calculate("-".repeat(200) + "1")).toEqual({ ok: false, error: "expression is nested too deeply" });
    expect(calculate("1+".repeat(300) + "1")).toEqual({ ok: false, error: "expression is longer than 500 characters" });
  });

  it("normalizes the expression and formats the display", () => {
    expect(calculate(" 12 * 5 / 1.5 ")).toEqual({ ok: true, value: 40, normalized: "12*5/1.5", display: "40" });
    expect(calculate("SQRT( 2 )")).toMatchObject({ normalized: "sqrt(2)", display: "1.414213562" });
    expect(calculate("0.1 + 0.2")).toMatchObject({ value: 0.1 + 0.2, display: "0.3" });
  });
});

describe("formatNumber", () => {
  it.each([
    [40, "40"],
    [1 / 3, "0.3333333333"],
    [-0, "0"],
    [1234567.891, "1234567.891"],
    [1e21, "1e+21"],
  ])("%s → %s", (n, expected) => {
    expect(formatNumber(n)).toBe(expected);
  });
});
