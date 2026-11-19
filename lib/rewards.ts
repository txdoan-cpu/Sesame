import { z } from "zod";

/**
 * Reward rules (CLAUDE.md §7.4). Rewards are about learning, never about
 * minutes online: no rule here looks at time spent.
 */

export const REWARD_DEFAULT_RETENTION_DAYS = 7;

/** Parent's form input. Scores are entered as percentages (50–100). */
export const RewardRuleInputSchema = z
  .object({
    learnerId: z.uuid(),
    outcomes: z.array(z.string().regex(/^8(N|PR|SS|SP)\d+$/)).min(1).max(17),
    minScorePercent: z.coerce.number().int().min(50).max(100),
    retentionDays: z.coerce.number().int().min(1).max(60).default(REWARD_DEFAULT_RETENTION_DAYS),
    deadline: z.iso.date(),
    rewardText: z.string().trim().min(1).max(120),
    value: z.union([z.literal(""), z.coerce.number().min(0).max(10000)]).optional(),
  })
  .transform((r) => ({ ...r, outcomes: [...new Set(r.outcomes)], value: r.value === "" ? undefined : r.value }));

export type RewardRuleInput = z.infer<typeof RewardRuleInputSchema>;

export function isFutureDate(isoDate: string, today: Date): boolean {
  return isoDate > today.toISOString().slice(0, 10);
}

/** % progress shown to the parent: achieved outcomes / goal outcomes (§7.3 reward_progress). */
export function rewardProgress(achieved: boolean[]): { achieved: number; total: number; percent: number } {
  const done = achieved.filter(Boolean).length;
  return { achieved: done, total: achieved.length, percent: achieved.length ? Math.round((done / achieved.length) * 100) : 0 };
}

export type Feasibility = "on_track" | "at_risk" | "unlikely";

/** Rough time to reach an outcome at about one lesson per week (demo assumption). */
export const DAYS_PER_OUTCOME = 7;

/**
 * Warns the parent when a goal is very unlikely to be met before the deadline
 * (§7.4). Every outcome not yet achieved needs about a week, and the
 * retention check needs `retentionDays` after that.
 */
export function rewardFeasibility(
  rule: { outcomes: string[]; deadline: string; retentionDays: number },
  achievedOutcomes: ReadonlySet<string>,
  today: Date,
): { feasibility: Feasibility; daysLeft: number; daysNeeded: number } {
  const notYet = rule.outcomes.filter((o) => !achievedOutcomes.has(o)).length;
  const daysNeeded = notYet * DAYS_PER_OUTCOME + rule.retentionDays;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = Date.parse(`${rule.deadline}T00:00:00Z`);
  const daysLeft = Math.round((end - start) / 86_400_000);
  const feasibility: Feasibility = daysLeft < daysNeeded ? "unlikely" : daysLeft < daysNeeded * 1.5 ? "at_risk" : "on_track";
  return { feasibility, daysLeft, daysNeeded };
}

/** Learner's reply to a goal: accept it, or suggest a change in their own words. */
export const RewardReplySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), ruleId: z.uuid() }),
  z.object({ action: z.literal("suggest"), ruleId: z.uuid(), note: z.string().trim().min(1).max(300) }),
]);

/* ------------------------------------------------------------------------- */
/* Evaluation (Round 6). Uses assessment results only, never time online.    */
/* ------------------------------------------------------------------------- */

export type EvalAssessment = { outcome_code: string; kind: "exit" | "retention"; score: number; mastered: boolean; taken_at: string };

export type EvalRule = {
  outcomes: string[];
  min_score: number;
  retention_days: number;
  deadline: string; // yyyy-MM-dd, last day included
  status: "active" | "unlocked" | "fulfilled" | "expired";
};

export type RuleEvaluation = {
  /** Outcomes reached with score ≥ min_score (and the explanation), with the first time it happened. */
  achieved: { outcome: string; at: string }[];
  /** Outcomes whose retention check (≥ retention_days later, ≥ min_score) passed. */
  retained: string[];
  unlock: boolean;
  expire: boolean;
};

const DAY_MS = 86_400_000;

/**
 * §7.4: unlock only when every listed outcome is achieved with score ≥ min_score
 * AND a retention check taken ≥ retention_days later is also ≥ min_score.
 */
export function evaluateRule(rule: EvalRule, assessments: EvalAssessment[], now: Date, deadlineEndsAt: Date): RuleEvaluation {
  const achieved: { outcome: string; at: string }[] = [];
  const retained: string[] = [];
  for (const outcome of rule.outcomes) {
    const passing = assessments
      .filter((a) => a.outcome_code === outcome && a.score >= rule.min_score && a.mastered)
      .sort((x, y) => x.taken_at.localeCompare(y.taken_at));
    if (!passing.length) continue;
    const first = passing[0];
    achieved.push({ outcome, at: first.taken_at });
    const due = new Date(first.taken_at).getTime() + rule.retention_days * DAY_MS;
    if (passing.some((a) => new Date(a.taken_at).getTime() >= due)) retained.push(outcome);
  }
  const unlock = rule.status === "active" && retained.length === rule.outcomes.length;
  const expire = rule.status === "active" && !unlock && now.getTime() > deadlineEndsAt.getTime();
  return { achieved, retained, unlock, expire };
}

/** Achieved outcomes not announced yet. The unlock itself comes later, with the retention check. */
export function newMilestones(evaluation: RuleEvaluation, alreadyNotified: string[]): string[] {
  return evaluation.achieved.map((a) => a.outcome).filter((o) => !alreadyNotified.includes(o));
}

/** "Halfway there!" when half the outcomes are reached; otherwise a count. */
export function milestoneKind(achievedCount: number, total: number): "halfway" | "progress" | "all_reached" {
  if (achievedCount >= total) return "all_reached";
  if (achievedCount * 2 === total) return "halfway";
  return "progress";
}

const PRAISE_BY_MISCONCEPTION: Record<string, string> = {
  M1: "You kept both sides balanced every time. That is the heart of solving equations.",
  M2: "You fixed the distributive mistake yourself: the number outside the brackets now multiplies everything inside.",
  M3: "You got the signs right with negative numbers. That takes real care.",
  M4: "You undo adding and taking away first, then divide. That is exactly the right order.",
  M5: "You now read the equals sign as 'balanced'. That idea will help you in every math class.",
};

/**
 * A specific praise sentence for effort, suggested to the parent on unlock (§7.4).
 * Prefers a mistake the learner had when the goal was set and no longer makes.
 */
export function praiseSentence(input: { misconceptionsAtStart: string[]; misconceptionsNow: string[]; outcomes: string[] }): string {
  const fixed = input.misconceptionsAtStart.filter((m) => !input.misconceptionsNow.includes(m)).sort();
  for (const m of fixed) if (PRAISE_BY_MISCONCEPTION[m]) return PRAISE_BY_MISCONCEPTION[m];
  return `You reached ${input.outcomes.join(" and ")} and still remembered it a week later. Your steady practice made that happen.`;
}
