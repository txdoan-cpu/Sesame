import { describe, expect, it } from "vitest";
import raw from "@/content/lessons/8PR2-demo-A.json";
import { FIT_WEIGHTS, fitDecision, fitScore } from "@/lib/lesson/fit";
import { LessonSchema } from "@/lib/lesson/schema";

const lesson = LessonSchema.parse(raw);

describe("Pedagogical Fit Score (proposal, Solution 1)", () => {
  it("weights add up to 100", () => {
    expect(Object.values(FIT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("scales 0–3 scores to 0–100", () => {
    const all = (n: number) => Object.fromEntries(Object.keys(FIT_WEIGHTS).map((k) => [k, n]));
    expect(fitScore(all(3))).toBe(100);
    expect(fitScore(all(0))).toBe(0);
    expect(fitScore({})).toBe(0);
    expect(fitScore({ A1: 3 })).toBe(20);
  });

  it("decides by threshold and gate", () => {
    expect(fitDecision(75, true)).toBe("deliver");
    expect(fitDecision(74, true)).toBe("revise");
    expect(fitDecision(60, true)).toBe("revise");
    expect(fitDecision(59, true)).toBe("teacher_review");
    expect(fitDecision(100, false)).toBe("rejected");
  });
});

describe("8PR2-demo-A rationale card", () => {
  const r = lesson.rationale!;

  it("is good enough to deliver", () => {
    expect(r.gate_passed).toBe(true);
    expect(fitScore(r.criteria_scores)).toBe(92);
    expect(fitDecision(fitScore(r.criteria_scores), r.gate_passed)).toBe("deliver");
  });

  it("covers every signal in profile demo-A, with English and Vietnamese text", () => {
    const text = r.rows.map((x) => x.signal_en).join(" ");
    for (const signal of [/85%/, /45%/, /M2/, /M3/, /anxiety/, /hockey/, /Grade 6/]) expect(text).toMatch(signal);
    for (const row of r.rows) {
      expect(row.signal_vi.length).toBeGreaterThan(5);
      expect(row.method_vi.length).toBeGreaterThan(5);
    }
  });

  it("marks reasons about mistakes and feelings as private unless misconceptions are shared", () => {
    for (const row of r.rows) {
      if (/M\d|anxiety/.test(row.signal_en)) expect(row.requires, row.signal_en).toBe("misconceptions");
      if (/%/.test(row.signal_en)) expect(row.requires, row.signal_en).toBe("outcome_status");
    }
  });

  it("never uses learning styles (CLAUDE.md §11)", () => {
    const all = JSON.stringify(r).toLowerCase();
    expect(all).not.toMatch(/learning style|visual learner|auditory learner|kinesthetic/);
  });
});
