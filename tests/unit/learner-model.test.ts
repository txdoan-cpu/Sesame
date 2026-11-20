import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import raw from "@/content/lessons/8PR2-demo-A.json";
import {
  DEFAULT_PARAMS,
  LEARNER_MODEL,
  bktUpdate,
  confidenceOfEstimate,
  estimateTransit,
  itemsToMastery,
  learningRateLevel,
  logLikelihood,
  readiness,
  replay,
  type SkillSequence,
} from "@/lib/learner/bkt";
import { PACE_TABLE, paceFor } from "@/lib/learner/pace";
import { LessonSchema } from "@/lib/lesson/schema";
import { pacedItems } from "@/lib/lesson/view";

const P = DEFAULT_PARAMS;

describe("learner model data (§7.8)", () => {
  it("uses the defaults until calibrated: p_init 0.3, p_transit 0.2, p_slip 0.1, p_guess 0.2; re-estimate every 20 answers", () => {
    expect(LEARNER_MODEL.bkt_defaults).toEqual({ p_init: 0.3, p_transit: 0.2, p_slip: 0.1, p_guess: 0.2 });
    expect(LEARNER_MODEL.reestimate_every_answers).toBe(20);
  });

  it("pace table matches Appendix C", () => {
    expect(PACE_TABLE.segment_minutes_max).toEqual({ slow: 3, medium: 4, fast: 5 });
    expect(PACE_TABLE.worked_examples_before_fading).toEqual({ slow: 3, medium: 2, fast: 1 });
    expect(PACE_TABLE.check_every_minutes).toEqual({ slow: 2, medium: 3, fast: 4 });
    expect(PACE_TABLE.practice_items).toEqual({ slow: [6, 8], medium: [4, 6], fast: [2, 3] });
    expect(PACE_TABLE.narration_rate).toEqual({ slow: 0.9, medium: 1.0, fast: 1.05 });
    expect(PACE_TABLE.review_after_days).toEqual({ slow: [1, 3, 7], medium: [2, 7], fast: [7] });
  });
});

describe("standard BKT update", () => {
  it("correct answer: evidence then learning", () => {
    // posterior = 0.3·0.9 / (0.3·0.9 + 0.7·0.2) = 0.27 / 0.41; then + (1 − posterior)·0.2
    const post = 0.27 / 0.41;
    expect(bktUpdate(0.3, true, P)).toBeCloseTo(post + (1 - post) * 0.2, 10);
    expect(bktUpdate(0.3, true, P)).toBeCloseTo(0.7268, 4);
  });

  it("wrong answer: evidence then learning", () => {
    // posterior = 0.3·0.1 / (0.3·0.1 + 0.7·0.8) = 0.03 / 0.59
    const post = 0.03 / 0.59;
    expect(bktUpdate(0.3, false, P)).toBeCloseTo(post + (1 - post) * 0.2, 10);
    expect(bktUpdate(0.3, false, P)).toBeCloseTo(0.2407, 4);
  });

  it("a correct answer always moves mastery up; a wrong one moves a high estimate down", () => {
    for (const L of [0.05, 0.3, 0.6, 0.9]) expect(bktUpdate(L, true, P)).toBeGreaterThan(L);
    for (const L of [0.6, 0.9]) expect(bktUpdate(L, false, P)).toBeLessThan(L);
  });

  it("stays inside [0, 1] and replay equals step-by-step updates", () => {
    const answers = [true, false, true, true, false, true];
    let L = 0.45;
    for (const a of answers) {
      L = bktUpdate(L, a, P);
      expect(L).toBeGreaterThanOrEqual(0);
      expect(L).toBeLessThanOrEqual(1);
    }
    expect(replay(0.45, answers, P)).toBeCloseTo(L, 12);
  });

  it("with no learning (p_transit 0) a wrong answer is pure evidence", () => {
    const p0 = { ...P, pTransit: 0 };
    expect(bktUpdate(0.5, false, p0)).toBeCloseTo((0.5 * 0.1) / (0.5 * 0.1 + 0.5 * 0.8), 10);
  });

  it("log-likelihood is higher for the parameter that generated the pattern", () => {
    const wrong = Array(10).fill(false);
    expect(logLikelihood(0.3, wrong, { ...P, pTransit: 0.05 })).toBeGreaterThan(logLikelihood(0.3, wrong, { ...P, pTransit: 0.4 }));
  });
});

describe("individualized learning rate (p_transit re-estimated every 20 answers)", () => {
  const seq = (pInit: number, ...answers: boolean[]): SkillSequence => ({ pInit, answers });

  it("returns null without answers", () => {
    expect(estimateTransit([])).toBeNull();
    expect(estimateTransit([seq(0.3)])).toBeNull();
  });

  it("simulated learner answering wrong 20 times in a row is moved to slow pacing", () => {
    // Starts at the default (0.2 → medium), spread over the lesson's skills like a real session.
    expect(learningRateLevel(P.pTransit)).toBe("medium");
    const skills = ["8PR2.one_step", "8PR2.two_step", "8PR2.distributive", "8N7.integers"];
    const sequences = skills.map((_, i) => seq(0.3, ...Array(i < 2 ? 6 : 4).fill(false)));
    expect(sequences.reduce((n, s) => n + s.answers.length, 0)).toBe(20);
    const t = estimateTransit(sequences)!;
    expect(t).toBeLessThan(0.15);
    expect(learningRateLevel(t)).toBe("slow");
    expect(paceFor(learningRateLevel(t)).practiceItems[0]).toBe(6);
  });

  it("a learner who gets everything right is moved to fast", () => {
    const t = estimateTransit([seq(0.3, ...Array(20).fill(true))])!;
    expect(learningRateLevel(t)).toBe("fast");
  });

  it("a learner who starts wrong and then gets it is medium or fast, not slow", () => {
    const t = estimateTransit([seq(0.3, false, false, true, true, true, true, true, true, true, true)])!;
    expect(learningRateLevel(t)).not.toBe("slow");
  });

  it("stays on the grid 0.01–0.5", () => {
    const t = estimateTransit([seq(0.3, true, false, true)])!;
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(0.5);
    expect(Math.round(t * 100) / 100).toBe(t);
  });
});

describe("learning-rate level thresholds: slow < 0.15 ≤ medium ≤ 0.30 < fast", () => {
  it.each([
    [0.01, "slow"],
    [0.149, "slow"],
    [0.15, "medium"],
    [0.25, "medium"],
    [0.3, "medium"],
    [0.31, "fast"],
  ] as const)("%s → %s", (t, level) => {
    expect(learningRateLevel(t)).toBe(level);
  });
});

describe("readiness, items to mastery, confidence", () => {
  const demoMastery = { "8PR2.one_step": 0.85, "8PR2.two_step": 0.45, "8PR2.distributive": 0.2, "8N7.integers": 0.7 };

  it("readiness is the mean mastery of the prerequisites", () => {
    expect(readiness(["8PR2.one_step", "8N7.integers"], demoMastery)).toBeCloseTo(0.78, 1);
    expect(readiness(["8N7.integers"], demoMastery)).toBe(0.7);
  });

  it("an outcome code counts as the mean of its skills; unknown prerequisites use p_init", () => {
    expect(readiness(["8PR2"], demoMastery)).toBe(0.5); // (0.85 + 0.45 + 0.2) / 3
    expect(readiness(["8SS1"], demoMastery)).toBe(0.3);
    expect(readiness([], demoMastery)).toBeNull();
  });

  it("items to mastery shrink as the learning rate grows", () => {
    expect(itemsToMastery(0.3, 0.25)).toBe(10);
    expect(itemsToMastery(0.3, 0.05)).toBeGreaterThan(itemsToMastery(0.3, 0.25));
    expect(itemsToMastery(0.97, 0.2)).toBe(0);
  });

  it("confidence grows with answers, never drops, and is capped", () => {
    expect(confidenceOfEstimate(0, 10)).toBe(0.5);
    expect(confidenceOfEstimate(0, 20)).toBe(0.67);
    expect(confidenceOfEstimate(0.7, 2)).toBe(0.7);
    expect(confidenceOfEstimate(0, 10_000)).toBe(0.95);
  });
});

describe("automatic pacing in the lesson", () => {
  const lesson = LessonSchema.parse(raw);
  const practice = lesson.slides[7].checkpoint!;

  it("slow learners get 6 practice items, medium 4, fast 2 plus the transfer task", () => {
    expect(pacedItems(practice, "slow").map((i) => i.id)).toEqual(["s8a", "s8b", "s8c", "s8d", "s8e", "s8f"]);
    expect(pacedItems(practice, "medium").map((i) => i.id)).toEqual(["s8a", "s8b", "s8c", "s8d"]);
    expect(pacedItems(practice, "fast").map((i) => i.id)).toEqual(["s8a", "s8c", "s8t"]);
  });

  it("slides without pacing show every item", () => {
    const s1 = lesson.slides[0].checkpoint!;
    expect(pacedItems(s1, "slow")).toEqual(s1.items);
    expect(pacedItems(practice, null)).toHaveLength(practice.items.length);
  });

  it("narration speed follows the pace table", () => {
    expect([paceFor("slow").narrationRate, paceFor("medium").narrationRate, paceFor("fast").narrationRate]).toEqual([0.9, 1, 1.05]);
  });
});
