import { z } from "zod";
import raw from "@/content/pedagogy/learner_model.json";

/**
 * Bayesian Knowledge Tracing (CLAUDE.md §7.8). Pure functions, no I/O.
 * Parameters live in content/pedagogy/learner_model.json.
 *
 * After each scored answer:
 *   P(L | correct) = P(L)(1 − S) / [P(L)(1 − S) + (1 − P(L))G]
 *   P(L | wrong)   = P(L)S       / [P(L)S       + (1 − P(L))(1 − G)]
 *   P(L next)      = P(L | obs) + (1 − P(L | obs)) · T
 */

export const LearnerModelSchema = z.object({
  bkt_defaults: z.object({
    p_init: z.number().min(0).max(1),
    p_transit: z.number().min(0).max(1),
    p_slip: z.number().min(0).max(0.5),
    p_guess: z.number().min(0).max(0.5),
  }),
  reestimate_every_answers: z.number().int().positive(),
  transit_grid: z.object({ min: z.number().positive(), max: z.number().max(1), step: z.number().positive() }),
  learning_rate_levels: z.object({ slow_below: z.number(), fast_above: z.number() }),
  mastery_target: z.number().min(0.5).max(1),
  confidence: z.object({ answers_for_half: z.number().positive(), max: z.number().max(1) }),
});

export const LEARNER_MODEL = LearnerModelSchema.parse(raw);

export type BktParams = { pTransit: number; pSlip: number; pGuess: number };
export type LearningRateLevel = "slow" | "medium" | "fast";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export const DEFAULT_PARAMS: BktParams = {
  pTransit: LEARNER_MODEL.bkt_defaults.p_transit,
  pSlip: LEARNER_MODEL.bkt_defaults.p_slip,
  pGuess: LEARNER_MODEL.bkt_defaults.p_guess,
};

/** Probability of answering correctly given the current mastery estimate. */
export function pCorrect(pMastery: number, p: BktParams): number {
  return pMastery * (1 - p.pSlip) + (1 - pMastery) * p.pGuess;
}

/** One BKT step: evidence from one answer, then the chance to learn. */
export function bktUpdate(pMastery: number, correct: boolean, p: BktParams): number {
  const L = clamp01(pMastery);
  const posterior = correct
    ? (L * (1 - p.pSlip)) / (L * (1 - p.pSlip) + (1 - L) * p.pGuess)
    : (L * p.pSlip) / (L * p.pSlip + (1 - L) * (1 - p.pGuess));
  return clamp01(posterior + (1 - posterior) * p.pTransit);
}

/** Mastery after a sequence of answers, starting from pInit. */
export function replay(pInit: number, answers: readonly boolean[], p: BktParams): number {
  return answers.reduce((L, c) => bktUpdate(L, c, p), clamp01(pInit));
}

/** Log-likelihood of an answer sequence under the model (used to fit pTransit). */
export function logLikelihood(pInit: number, answers: readonly boolean[], p: BktParams): number {
  let L = clamp01(pInit);
  let ll = 0;
  for (const c of answers) {
    const pc = Math.min(1 - 1e-9, Math.max(1e-9, pCorrect(L, p)));
    ll += Math.log(c ? pc : 1 - pc);
    L = bktUpdate(L, c, p);
  }
  return ll;
}

export type SkillSequence = { pInit: number; answers: boolean[] };

/**
 * Individualized BKT: the learner's own learning rate. Grid search for the
 * pTransit that best explains all of their answer sequences (slip and guess
 * stay at the defaults). Ties go to the value closest to the default.
 * Returns null when there are no answers.
 */
export function estimateTransit(sequences: readonly SkillSequence[], base: BktParams = DEFAULT_PARAMS): number | null {
  if (!sequences.some((s) => s.answers.length)) return null;
  const { min, max, step } = LEARNER_MODEL.transit_grid;
  let best = base.pTransit;
  let bestLl = -Infinity;
  const steps = Math.round((max - min) / step);
  for (let i = 0; i <= steps; i++) {
    const t = round(min + i * step, 4);
    const p = { ...base, pTransit: t };
    const ll = sequences.reduce((sum, s) => sum + logLikelihood(s.pInit, s.answers, p), 0);
    const better = ll > bestLl + 1e-12 || (Math.abs(ll - bestLl) <= 1e-12 && Math.abs(t - base.pTransit) < Math.abs(best - base.pTransit));
    if (better) {
      best = t;
      bestLl = ll;
    }
  }
  return best;
}

/** slow < 0.15 ≤ medium ≤ 0.30 < fast (initial thresholds, §7.8). */
export function learningRateLevel(pTransit: number): LearningRateLevel {
  const { slow_below, fast_above } = LEARNER_MODEL.learning_rate_levels;
  if (pTransit < slow_below) return "slow";
  if (pTransit > fast_above) return "fast";
  return "medium";
}

/**
 * Practice opportunities needed to go from pInit to the mastery target if the
 * learner only learns at rate pTransit (no evidence). A rough guide for the
 * profile's items_to_mastery_avg, not a promise.
 */
export function itemsToMastery(pInit: number, pTransit: number): number {
  const target = LEARNER_MODEL.mastery_target;
  if (pInit >= target) return 0;
  if (pTransit <= 0) return Infinity;
  return Math.ceil(Math.log((1 - target) / (1 - pInit)) / Math.log(1 - pTransit));
}

/**
 * readiness = mean p_mastery of the LO's prerequisites (§7.8, §9). Each
 * prerequisite is a skill id ("8N7.integers") or an outcome code ("8N7"),
 * which counts as the mean of that outcome's known skills. Unknown
 * prerequisites use p_init. Null when the LO has no prerequisites.
 */
export function readiness(prerequisites: readonly string[], mastery: Readonly<Record<string, number>>): number | null {
  if (!prerequisites.length) return null;
  const values = prerequisites.map((pre) => {
    if (pre in mastery) return mastery[pre];
    const skills = Object.entries(mastery).filter(([k]) => k.startsWith(`${pre}.`));
    return skills.length ? skills.reduce((s, [, v]) => s + v, 0) / skills.length : LEARNER_MODEL.bkt_defaults.p_init;
  });
  return round(values.reduce((a, b) => a + b, 0) / values.length, 2);
}

/**
 * Confidence of the estimate grows with evidence: n / (n + k), capped. It never
 * drops below what the profile already had (for example from a diagnostic quiz).
 */
export function confidenceOfEstimate(previous: number, answers: number): number {
  const { answers_for_half, max } = LEARNER_MODEL.confidence;
  return round(Math.max(previous, Math.min(max, answers / (answers + answers_for_half))), 2);
}
