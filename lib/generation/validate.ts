import { evaluateExpression, expressionEquals, satisfies, splitEquation } from "@/lib/math/check";
import type { CheckItem, Lesson, NumericItem } from "@/lib/lesson/schema";

/**
 * Math gate for generated lessons (CLAUDE.md §7.9): every equation and answer
 * must pass substitution with lib/math/check.ts. Any failure blocks delivery.
 */

export type MathFailure = { where: string; detail: string };

/** A real equation in x: the answer works and a different value does not. */
function solves(equation: string, answer: number): boolean {
  return satisfies(equation, answer) && !satisfies(equation, answer + 1);
}

function numericItem(item: NumericItem, where: string, out: MathFailure[]) {
  if (!item.equation && !item.expression) {
    out.push({ where, detail: "no equation or expression to check the answer against" });
    return;
  }
  if (item.equation && !solves(item.equation, item.answer)) out.push({ where, detail: `x = ${item.answer} does not solve ${item.equation}` });
  if (item.expression && !expressionEquals(item.expression, item.answer)) out.push({ where, detail: `${item.expression} is not ${item.answer}` });
}

function checkItem(item: CheckItem, where: string, out: MathFailure[]) {
  if (item.kind === "numeric") numericItem(item, where, out);
}

/** True when both sides of a plain arithmetic line ("3(5) + 4 = 19") are equal. */
function arithmeticHolds(line: string): boolean {
  try {
    const { left, right } = splitEquation(line);
    const l = evaluateExpression(left);
    const r = evaluateExpression(right);
    return l !== null && r !== null && Math.abs(l - r) < 1e-9;
  } catch {
    return false;
  }
}

export function checkLessonMath(lesson: Lesson): MathFailure[] {
  const out: MathFailure[] = [];
  for (const s of lesson.slides) {
    const where = `slide ${s.no}`;
    for (const item of s.checkpoint?.items ?? []) checkItem(item, `${where}, item ${item.id}`, out);
    const v = s.visual;
    if (v.type === "steps") {
      v.lines.forEach((line, i) => {
        if (!satisfies(line, v.solution)) out.push({ where: `${where}, step ${i + 1}`, detail: `x = ${v.solution} does not make "${line}" true` });
      });
      // A line without x (a check such as "3(5) + 4 = 19") only has to be true, which the loop above tests.
      // A line in x must pin down the solution: true for x = solution, false for another value.
      v.lines.forEach((line, i) => {
        if (/x/i.test(line) && satisfies(line, v.solution) && satisfies(line, v.solution + 1)) {
          out.push({ where: `${where}, step ${i + 1}`, detail: `"${line}" is true for every x, so it does not pin down x = ${v.solution}` });
        }
      });
      if (v.check && !arithmeticHolds(v.check)) out.push({ where: `${where}, check`, detail: `"${v.check}" is not true` });
    }
    if (v.type === "compare") {
      const right = v.people.filter((p) => solves(v.equation, p.answer));
      if (right.length !== 1) out.push({ where, detail: `exactly one person must solve ${v.equation} correctly (found ${right.length})` });
      for (const p of right) {
        p.lines.forEach((line, i) => {
          if (!satisfies(line, p.answer)) out.push({ where: `${where}, ${p.name} step ${i + 1}`, detail: `x = ${p.answer} does not make "${line}" true` });
        });
      }
    }
    if (v.type === "balance") {
      const eq = `${v.left} = ${v.right}`;
      try {
        splitEquation(eq);
      } catch {
        out.push({ where, detail: `balance sides do not form an equation: ${eq}` });
      }
    }
  }
  lesson.diagnostic.forEach((d) => numericItem(d, `diagnostic ${d.id}`, out));
  for (const q of lesson.exit_ticket.choice) {
    if (!q.equation) continue;
    for (const o of q.options) {
      const where = `exit ticket ${q.id}, option ${o.id}`;
      if (o.value === undefined) {
        out.push({ where, detail: "option has no value to check" });
        continue;
      }
      const ok = satisfies(q.equation, o.value);
      if (o.correct && !ok) out.push({ where, detail: `marked correct but x = ${o.value} does not solve ${q.equation}` });
      if (!o.correct && ok) out.push({ where, detail: `marked wrong but x = ${o.value} solves ${q.equation}` });
    }
  }
  return out;
}
