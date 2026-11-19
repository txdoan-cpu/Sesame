/**
 * Pedagogical Fit Score (proposal, Solution 1). Each criterion is scored 0–3;
 * the score is the weighted total scaled to 0–100. Gate G (correct and safe)
 * must pass, or the lesson is rejected whatever the score.
 */

export const FIT_WEIGHTS = { A1: 20, A2: 10, B1: 15, B2: 10, B3: 10, B4: 10, C1: 10, D1: 5, E1: 10 } as const;

export type Criterion = keyof typeof FIT_WEIGHTS;

export function fitScore(scores: Partial<Record<Criterion, number>>): number {
  let total = 0;
  for (const [criterion, weight] of Object.entries(FIT_WEIGHTS) as [Criterion, number][]) {
    const s = Math.min(3, Math.max(0, scores[criterion] ?? 0));
    total += (weight * s) / 3;
  }
  return Math.round(total);
}

export type FitDecision = "deliver" | "revise" | "teacher_review" | "rejected";

/** ≥ 75 and gate passed → deliver; 60–74 → revise; < 60 → teacher review; gate failed → rejected. */
export function fitDecision(score: number, gatePassed: boolean): FitDecision {
  if (!gatePassed) return "rejected";
  if (score >= 75) return "deliver";
  if (score >= 60) return "revise";
  return "teacher_review";
}
