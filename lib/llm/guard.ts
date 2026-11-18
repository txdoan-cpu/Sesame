import { normaliseMath, satisfies } from "@/lib/math/check";
import type { AskModelOutput } from "./prompts";

/**
 * Checks on a model answer before it is shown or spoken (CLAUDE.md §7.2).
 * 1. Every numeric result about an equation must pass substitution.
 * 2. Never reveal the answer to an exit-ticket item.
 */

const NUM = String.raw`-?\d+(?:\.\d+)?`;

/** Equations in x written in the text, e.g. "3x + 4 = 19". */
export function equationsInText(text: string): string[] {
  const t = normaliseMath(text);
  const re = /[-\d\sx+*/().]*x[-\d\sx+*/().]*=\s*-?[\d\sx+*/().-]*\d[\d\s)]*/g;
  return [...t.matchAll(re)]
    .map((m) => m[0].trim().replace(/[.\s]+$/, ""))
    .filter((eq) => /\d/.test(eq.split("=")[0]) || /\d/.test(eq.split("=")[1]));
}

/**
 * Values the text states for x: "x = 5", "x is -4", "x equals 6".
 * Not "x is 4 times…" or "x = 2x…" (descriptions or expressions, not results).
 */
export function statedValues(text: string): number[] {
  const t = normaliseMath(text).toLowerCase();
  const notResult = String.raw`(?![\d.]*\s*(?:[x*/(+]|-\s*\d|times|groups?|lots|more|less|fewer|bigger|smaller))`;
  const re = new RegExp(String.raw`\bx\s*(?:=|is|equals)\s*(${NUM})${notResult}`, "g");
  return [...t.matchAll(re)].map((m) => Number(m[1]));
}

export type MathCheck = { ok: boolean; failures: string[] };

/**
 * Passes when every claim satisfies its equation, and every value stated in
 * the answer solves at least one known equation (slide, question, answer, claims).
 */
export function verifyMath(output: AskModelOutput, contextEquations: string[]): MathCheck {
  const failures: string[] = [];
  for (const c of output.math_claims) {
    if (!satisfies(c.equation, c.x)) failures.push(`claim ${c.equation} with x = ${c.x}`);
  }
  const text = `${output.answer} ${output.check_question}`;
  const known = [...contextEquations, ...output.math_claims.map((c) => c.equation), ...equationsInText(text)].filter(
    (eq) => !/^\s*x\s*=\s*-?[\d.]+\s*$/.test(eq), // "x = 5" alone is a statement, not context
  );
  for (const v of statedValues(text)) {
    if (!known.some((eq) => satisfies(eq, v))) failures.push(`stated x = ${v} solves no known equation`);
  }
  return { ok: failures.length === 0, failures };
}

function compact(eq: string): string {
  return normaliseMath(eq).replace(/\s+/g, "").toLowerCase();
}

/** True when the answer gives away the solution of an exit-ticket equation. */
export function leaksExitAnswer(output: AskModelOutput, exitItems: { equation: string; answer: number }[]): boolean {
  const text = `${output.answer} ${output.check_question}`;
  const textCompact = compact(text);
  const values = statedValues(text);
  return exitItems.some(({ equation, answer }) => {
    const mentioned = textCompact.includes(compact(equation)) || output.math_claims.some((c) => compact(c.equation) === compact(equation));
    const claimed = output.math_claims.some((c) => compact(c.equation) === compact(equation) && Math.abs(c.x - answer) < 1e-9);
    const stated = values.some((v) => Math.abs(v - answer) < 1e-9);
    return claimed || (mentioned && stated);
  });
}

/** Keeps answers short for the learner: cut at a sentence end near the word limit. */
export function trimWords(text: string, maxWords = 100): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  const cut = words.slice(0, maxWords).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > cut.length / 2 ? cut.slice(0, lastStop + 1) : `${cut}…`;
}

export const MATH_FALLBACK =
  "Let me not guess on that one. Let's look at the steps on the slide together. Do one small step, and do it to both sides.";

export const LEAK_FALLBACK =
  "I can't give you the answer to that one, but here is a hint: undo the adding or taking away first, and do it to both sides. Then undo the multiplying.";

export const PARSE_FALLBACK =
  "Good question! Let's look at the slide again. Remember: whatever you do to one side, do to the other side too.";
