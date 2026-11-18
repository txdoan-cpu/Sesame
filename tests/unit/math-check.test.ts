import { describe, expect, it } from "vitest";
import { checkClaim, expressionEquals, satisfies, splitEquation, toTex } from "@/lib/math/check";
import { answerMatches, parseNumericAnswer } from "@/lib/math/answer";

describe("satisfies (substitution)", () => {
  it.each([
    ["3x + 4 = 19", 5],
    ["2(x + 3) = 14", 4],
    ["x/3 + 4 = 6", 6],
    ["-3x + 5 = -10", 5],
    ["2x + 9 = 1", -4],
    ["−3x + 5 = −10", 5], // Unicode minus
  ])("%s with x = %s", (eq, x) => {
    expect(satisfies(eq, x)).toBe(true);
  });

  it("rejects wrong values and the M2 mistake", () => {
    expect(satisfies("3x + 4 = 19", 6)).toBe(false);
    expect(satisfies("2(x + 3) = 14", 5.5)).toBe(false);
    // Liam's wrong first line is not equivalent to the original equation.
    expect(satisfies("2x + 3 = 14", 4)).toBe(false);
  });

  it("never throws on bad input", () => {
    expect(satisfies("not an equation", 1)).toBe(false);
    expect(satisfies("x = = 2", 2)).toBe(false);
    expect(satisfies("x + = 2", 2)).toBe(false);
    expect(() => splitEquation("3x + 4")).toThrow();
  });
});

describe("checkClaim", () => {
  it("passes true claims and explains failures", () => {
    expect(checkClaim("3x + 4 = 19", 5)).toEqual({ ok: true });
    expect(checkClaim("3x + 4 = 19", 4)).toEqual({ ok: false, reason: "substitution_failed" });
    expect(checkClaim("??", 4)).toEqual({ ok: false, reason: "unparseable_equation" });
  });
});

describe("expressionEquals", () => {
  it("evaluates check lines", () => {
    expect(expressionEquals("-3(5) + 5", -10)).toBe(true);
    expect(expressionEquals("3(5) + 4", 19)).toBe(true);
    expect(expressionEquals("3(5) + 4", 20)).toBe(false);
    expect(expressionEquals("x + 1", 1)).toBe(false); // unknown variable
  });
});

describe("toTex", () => {
  it("renders implicit multiplication without spaces and fractions", () => {
    expect(toTex("3x + 4 = 19")).toBe("3x+4 = 19");
    expect(toTex("x/3 + 4 = 6")).toContain("\\frac{ x}{3}");
    expect(toTex("2(x + 3)")).toBe("2( x+3)");
    expect(toTex("3(5) + 4")).toBe("3(5)+4");
  });
});

describe("parseNumericAnswer", () => {
  it.each([
    ["5", 5],
    [" x = 5 ", 5],
    ["x=−4", -4],
    ["-4", -4],
    ["5.5", 5.5],
    ["5,5", 5.5],
    ["11/2", 5.5],
    ["minus 4", -4],
    ["negative four", -4],
    ["x is 6", 6],
    ["the answer is 6", 6],
  ])("%j -> %s", (input, value) => {
    expect(parseNumericAnswer(input)).toBe(value);
  });

  it.each(["", "abc", "5 apples", "1/0"])("%j -> null", (input) => {
    expect(parseNumericAnswer(input)).toBeNull();
  });

  it("matches answers", () => {
    expect(answerMatches("x = -4", -4)).toBe(true);
    expect(answerMatches("4", -4)).toBe(false);
  });
});
