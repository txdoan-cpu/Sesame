import { parse } from "mathjs";

/**
 * Equation checks by substitution (CLAUDE.md §3, §7.2).
 * Equations are plain ASCII, e.g. "3x + 4 = 19", "x/3 + 4 = 6", "2(x + 3) = 14".
 */

const EPSILON = 1e-9;

export type Equation = { left: string; right: string };

/** Splits "a = b" into sides. Throws on anything that is not exactly one "=". */
export function splitEquation(equation: string): Equation {
  const parts = normaliseMath(equation).split("=");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new Error(`Not an equation: ${equation}`);
  }
  return { left: parts[0].trim(), right: parts[1].trim() };
}

/** Accepts the Unicode minus, ×, ÷ and · that appear in slide text. */
export function normaliseMath(text: string): string {
  return text.replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/");
}

/** Value of an expression for the given variables, or null if it cannot be evaluated. */
export function evaluateExpression(expression: string, scope: Record<string, number> = {}): number | null {
  try {
    const value: unknown = parse(normaliseMath(expression)).evaluate({ ...scope });
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** True when substituting `value` for `variable` makes both sides equal. */
export function satisfies(equation: string, value: number, variable = "x"): boolean {
  let eq: Equation;
  try {
    eq = splitEquation(equation);
  } catch {
    return false;
  }
  const left = evaluateExpression(eq.left, { [variable]: value });
  const right = evaluateExpression(eq.right, { [variable]: value });
  return left !== null && right !== null && Math.abs(left - right) < EPSILON;
}

/** True when an expression with no variables equals `expected` (e.g. "-3(5) + 5" and -10). */
export function expressionEquals(expression: string, expected: number): boolean {
  const value = evaluateExpression(expression);
  return value !== null && Math.abs(value - expected) < EPSILON;
}

/**
 * Checks a numeric claim about an equation before it is shown or spoken.
 * Returns ok=false (never throws) so callers can fall back safely and log.
 */
export function checkClaim(equation: string, claimed: number, variable = "x"): { ok: boolean; reason?: string } {
  try {
    splitEquation(equation);
  } catch {
    return { ok: false, reason: "unparseable_equation" };
  }
  return satisfies(equation, claimed, variable) ? { ok: true } : { ok: false, reason: "substitution_failed" };
}

/** TeX for an ASCII expression or equation, for KaTeX rendering. Falls back to escaped text. */
export function toTex(math: string): string {
  const text = normaliseMath(math);
  const sides = text.split("=");
  try {
    return sides
      .map((side) =>
        parse(side.trim())
          .toTex({ implicit: "hide", parenthesis: "keep" })
          .replace(/~\s?/g, "")
          // \left( adds space after a number; plain brackets read like the textbook: 3(5), 2(x+3).
          .replace(/\\left\(/g, "(")
          .replace(/\\right\)/g, ")")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .join(" = ");
  } catch {
    return `\\text{${text.replace(/[\\{}$&#^_%~]/g, "")}}`;
  }
}
