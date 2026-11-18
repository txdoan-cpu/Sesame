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
