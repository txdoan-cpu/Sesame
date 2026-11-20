import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import raw from "@/content/lessons/8PR2-demo-A.json";
import { assembleLesson, authorPayload, parseAuthorAnswer, type AuthorInput } from "@/lib/generation/author";
import { buildContext, SAMPLE_PROFILES, skillsFor, type OutcomeInput } from "@/lib/generation/context";
import { codeScores, combine, parseCriticAnswer } from "@/lib/generation/critic";
import { mockAuthor, mockCritic } from "@/lib/generation/mock";
import { CITATIONS, METHODS, RUBRIC_S, RULES } from "@/lib/generation/pedagogy";
import { planLesson, rubricT, scoreMethod, type PlanContext } from "@/lib/generation/planner";
import { checkLessonMath } from "@/lib/generation/validate";
import { LessonSchema } from "@/lib/lesson/schema";

const LO: OutcomeInput = {
  code: "9PR3",
  description: "Model and solve linear equations with rational coefficients",
  knowledgeType: "procedural",
  bloom: "apply",
  indicators: [
    { code: "9PR3.1", description: "Solve by inverse operations" },
    { code: "9PR3.2", description: "Verify by substitution" },
    { code: "9PR3.3", description: "Write an equation for a word problem" },
  ],
  misconceptions: [
    { code: "M1", description: "Operates on one side only" },
    { code: "M2", description: "Distributes wrongly" },
  ],
  prerequisites: ["8PR2"],
};

function ctx(over: Partial<PlanContext["learner"]> = {}, lo: Partial<OutcomeInput> = {}): PlanContext {
  return {
    lo: { ...LO, ...lo },
    learner: { readiness: 0.5, loMastery: 0, misconceptions: [], pace: "medium", prerequisiteMastery: { "8PR2": 0.5 }, confidence: 0.7, ...over },
  };
}
const methodsIn = (p: ReturnType<typeof planLesson>, a: string) => p.activities.find((x) => x.activity === a)!.methods.map((m) => m.id);
const allMethods = (p: ReturnType<typeof planLesson>) => p.activities.flatMap((a) => a.methods.map((m) => m.id));

describe("pedagogy data (Appendix C)", () => {
  it("has the 10 catalogue methods (+ refuted learning styles), D1–D8 and 15 Rubric S criteria", () => {
    const ids = METHODS.methods.map((m) => m.id);
    for (const id of ["direct_instruction_worked_examples", "faded_examples", "concreteness_fading", "compare_solutions_incorrect_examples", "guided_discovery", "problem_solving_transfer", "self_explanation", "retrieval_spacing_interleaving", "targeted_feedback", "collaborative_or_flipped"]) {
      expect(ids).toContain(id);
    }
    expect(METHODS.evidence_weights).toEqual({ A: 1, B: 0.8, C: 0.5, excluded: 0 });
    expect(RULES.map((r) => r.id)).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"]);
    expect(RUBRIC_S.criteria.filter((c) => c.gate).map((c) => c.id)).toEqual(["S1", "S10", "S11"]);
    expect(RUBRIC_S.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect([RUBRIC_S.deliver_min, RUBRIC_S.regenerate_min, RUBRIC_S.max_regenerations]).toEqual([75, 60, 2]);
  });

  it("every method cites evidence that exists", () => {
    for (const m of METHODS.methods) for (const c of m.citations) expect(CITATIONS.has(c), `${m.id} → ${c}`).toBe(true);
  });
});

describe("Rubric T × evidence", () => {
  it("scores 0–100 and weights by evidence grade", () => {
    const c = ctx();
    const faded = scoreMethod(METHODS.methods.find((m) => m.id === "faded_examples")!, c);
    const t = rubricT(METHODS.methods.find((m) => m.id === "faded_examples")!, c);
    const raw = (20 * t.T1 + 20 * t.T2 + 10 * t.T3 + 10 * t.T4 + 15 * t.T5 + 10 * t.T6 + 15 * t.T7) / 3;
    expect(faded.score).toBeCloseTo(0.8 * raw, 1); // evidence B
    expect(faded.score).toBeLessThanOrEqual(100);
  });

  it("learning styles always score 0 (evidence excluded)", () => {
    expect(scoreMethod(METHODS.methods.find((m) => m.id === "learning_styles")!, ctx()).score).toBe(0);
  });
});

describe("planner: rules D1–D8", () => {
  it("D1 readiness < 0.6: no guided discovery; worked examples, then faded examples", () => {
    const p = planLesson(ctx({ readiness: 0.5 }));
    expect(p.rulesApplied.map((r) => r.id)).toContain("D1");
    expect(allMethods(p)).not.toContain("guided_discovery");
    expect(methodsIn(p, "present")).toContain("direct_instruction_worked_examples");
    expect(methodsIn(p, "guided_practice")).toContain("faded_examples");
  });

  it("D2 mastery >= 0.8: no worked examples; a transfer task in apply", () => {
    const p = planLesson(ctx({ readiness: 0.9, loMastery: 0.85, prerequisiteMastery: { "8PR2": 0.9 } }));
    expect(allMethods(p)).not.toContain("direct_instruction_worked_examples");
    expect(methodsIn(p, "apply")).toContain("problem_solving_transfer");
    expect(p.slides.some((s) => s.template === "worked_example")).toBe(false);
  });

  it("D3 misconception present: a who's-right comparison showing that misconception", () => {
    const p = planLesson(ctx({ misconceptions: ["M2"] }));
    expect(allMethods(p)).toContain("compare_solutions_incorrect_examples");
    expect(p.slides.find((s) => s.template === "whos_right")?.misconception).toBe("M2");
  });

  it("D4 new symbolic concept: concrete first, before worked examples", () => {
    const p = planLesson(ctx({ loMastery: 0 }));
    expect(methodsIn(p, "present")).toEqual(["concreteness_fading", "direct_instruction_worked_examples"]);
  });

  it("D5 consolidation: retrieval in close and a spaced-review schedule", () => {
    const p = planLesson(ctx({ readiness: 0.8, loMastery: 0.65, prerequisiteMastery: { "8PR2": 0.85 } }));
    expect(methodsIn(p, "close")).toContain("retrieval_spacing_interleaving");
    expect(p.reviewAfterDays).toEqual([2, 7]);
  });

  it("D6 / D8: no passive methods, never learning styles; school-only methods are out", () => {
    const p = planLesson(ctx());
    expect(allMethods(p)).not.toContain("learning_styles");
    expect(allMethods(p)).not.toContain("collaborative_or_flipped");
    expect(p.excluded.map((e) => e.id)).toEqual(expect.arrayContaining(["learning_styles", "collaborative_or_flipped"]));
  });

  it("D7 weak prerequisite: activate reviews it", () => {
    const p = planLesson(ctx({ prerequisiteMastery: { "8PR2": 0.5 } }));
    expect(methodsIn(p, "activate")).toContain("retrieval_spacing_interleaving");
    expect(p.slides[0]).toMatchObject({ activity: "activate", template: "retrieval", prerequisites: ["8PR2"] });
  });

  it("pacing follows the pace table: practice size and worked examples before fading", () => {
    for (const [pace, practice, worked] of [["slow", 6, 3], ["medium", 4, 2], ["fast", 3, 1]] as const) {
      const p = planLesson(ctx({ pace, readiness: 0.5 }));
      expect(p.slides.find((s) => s.template === "practice")?.items, pace).toBe(practice);
      expect(p.slides.filter((s) => s.template === "worked_example").length, pace).toBe(worked);
    }
    expect(planLesson(ctx({ pace: "fast" })).slides.find((s) => s.template === "practice")?.transfer).toBe(true);
  });

  it("covers all five activities and assigns every indicator to a teaching slide", () => {
    const p = planLesson(ctx({ misconceptions: ["M1"] }));
    expect(new Set(p.slides.map((s) => s.activity))).toEqual(new Set(["activate", "present", "guided_practice", "apply", "close"]));
    for (const i of LO.indicators) expect(p.slides.some((s) => s.indicators.includes(i.code) && (s.activity === "present" || s.activity === "guided_practice"))).toBe(true);
  });

  it("asks for a diagnostic when the estimate is unsure", () => {
    expect(planLesson(ctx({ confidence: 0.5 })).needsDiagnostic).toBe(true);
    expect(planLesson(ctx({ confidence: 0.7 })).needsDiagnostic).toBe(false);
  });
});

describe("context from a profile", () => {
  it("demo-A for a new LO: readiness from 8PR2 skills, no LO mastery, only this LO's misconceptions", () => {
    const c = buildContext(LO, SAMPLE_PROFILES["demo-A"].profile);
    expect(c.learner.readiness).toBe(0.5); // mean of 8PR2.one_step .85, two_step .45, distributive .2
    expect(c.learner.loMastery).toBe(0);
    expect(c.learner.misconceptions).toEqual(["M2"]); // M3 is not one of 9PR3's
    expect(skillsFor("9PR3", SAMPLE_PROFILES["demo-A"].profile)).toEqual(["9PR3.core"]);
    expect(skillsFor("8PR2", SAMPLE_PROFILES["demo-A"].profile)).toEqual(["8PR2.one_step", "8PR2.two_step", "8PR2.distributive"]);
  });
});

function runOffline(materialText: string, pace: "slow" | "medium" | "fast" = "medium") {
  const c = buildContext(LO, { ...SAMPLE_PROFILES["demo-A"].profile, learning_rate: { level: pace } });
  const plan = planLesson(c);
  const input: AuthorInput = {
    plan,
    ctx: c,
    materials: [{ ref: "m1", id: "00000000-0000-4000-8000-0000000000aa", title: "Balance notes", sourceUrl: null, licence: "cc_by", excerpt: materialText }],
    skills: ["9PR3.core"],
    learner: { readingLevel: "grade 6", interests: ["hockey"] },
    feedback: [],
  };
  const parsed = parseAuthorAnswer(mockAuthor(authorPayload(input)));
  if (!parsed.ok) throw new Error(parsed.error);
  const assembled = assembleLesson("gen-00000000-test", input, parsed.value);
  if (!assembled.ok) throw new Error(assembled.error);
  const math = checkLessonMath(assembled.lesson);
  const result = combine(codeScores(assembled.lesson, plan, c, math), parseCriticAnswer(mockCritic()), 1);
  return { plan, lesson: assembled.lesson, math, result, problems: assembled.problems };
}

describe("pipeline offline (mock author and critic)", () => {
  it.each(["slow", "medium", "fast"] as const)("%s pace: a player-ready lesson that passes the math gate and scores >= 75", (pace) => {
    const { lesson, math, result, problems } = runOffline("Solve equations by keeping both sides balanced.", pace);
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
    expect(problems).toEqual([]);
    expect(math).toEqual([]);
    expect(result.failedGates).toEqual([]);
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.decision).toBe("deliver");
    // Every slide cites the approved material and keeps the planner's activity and method.
    for (const s of lesson.slides) {
      expect(s.sources).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
      expect(s.activity && s.method).toBeTruthy();
    }
  });

  it("a wrong answer is caught by the math gate (S10 = 0) and blocks delivery", () => {
    const { math, result } = runOffline("Practice sheet MATHBUG");
    expect(math.length).toBeGreaterThan(0);
    expect(result.scores.S10).toBe(0);
    expect(result.failedGates).toContain("S10");
    expect(result.decision).toBe("regenerate");
    expect(combine({ scores: result.scores, reasons: result.reasons }, parseCriticAnswer(mockCritic()), 3).decision).toBe("review");
  });

  it("the math gate also passes the pre-authored 8PR2 lesson", () => {
    expect(checkLessonMath(LessonSchema.parse(raw))).toEqual([]);
  });
});

describe("Rubric S decisions", () => {
  const all = (n: number) => Object.fromEntries(RUBRIC_S.criteria.map((c) => [c.id, n]));
  const code = (scores: Record<string, number>) => ({ scores, reasons: {} });

  it(">= 75 with gates passing → deliver", () => {
    expect(combine(code(all(3)), null, 1)).toMatchObject({ total: 100, decision: "deliver" });
  });
  it("60–74 → regenerate, at most twice, then review", () => {
    const s = all(2); // 67
    expect(combine(code(s), null, 1).decision).toBe("regenerate");
    expect(combine(code(s), null, 2).decision).toBe("regenerate");
    expect(combine(code(s), null, 3).decision).toBe("review");
  });
  it("< 60 → teacher review straight away", () => {
    expect(combine(code(all(1)), null, 1).decision).toBe("review");
  });
  it("a failed gate never delivers, even with a high total", () => {
    const r = combine(code({ ...all(3), S11: 1 }), null, 1);
    expect(r.total).toBeGreaterThanOrEqual(75);
    expect(r.failedGates).toEqual(["S11"]);
    expect(r.decision).toBe("regenerate");
  });
  it("without a model answer, model-only criteria count as weak (no unseen pass)", () => {
    const codeOnly = { S1: 3, S3: 3, S4: 3, S5: 3, S10: 3, S13: 3, S14: 3, S15: 3 };
    expect(combine(code(codeOnly), null, 1).scores.S2).toBe(1);
  });
});

describe("math gate details", () => {
  const base = LessonSchema.parse(raw);
  const withSteps = (lines: string[], solution: number) => ({
    ...base,
    slides: [{ ...base.slides[2], visual: { type: "steps" as const, lines, solution } }],
  });
  it("accepts a substitution check written as a step (no x)", () => {
    expect(checkLessonMath(withSteps(["3(5) + 4 = 19", "19 = 19"], 5))).toEqual([]);
  });
  it("rejects a false arithmetic step and a step that is true for every x", () => {
    expect(checkLessonMath(withSteps(["3(5) + 4 = 20"], 5)).length).toBe(1);
    expect(checkLessonMath(withSteps(["3x + 4 = 19", "x + x = 2x", "x = 5"], 5)).length).toBe(1);
  });
});
