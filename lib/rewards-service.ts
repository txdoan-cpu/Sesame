import "server-only";
import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateRule, milestoneKind, newMilestones, praiseSentence, type EvalAssessment } from "@/lib/rewards";
import { FAMILY_TZ } from "@/lib/time";

/**
 * Reward rule verification (§7.4). Runs on the server after every exit ticket
 * or retention check, and in the scheduled sweep (deadlines). Notifies both
 * sides on milestones; on unlock the parent gets a suggested praise sentence.
 */

const RuleRow = z.object({
  id: z.string(),
  parent_id: z.string(),
  learner_id: z.string(),
  outcomes: z.array(z.string()),
  min_score: z.coerce.number(),
  retention_days: z.number(),
  deadline: z.string(),
  reward_text: z.string(),
  status: z.enum(["active", "unlocked", "fulfilled", "expired"]),
  misconceptions_at_start: z.array(z.string()),
  milestones_notified: z.array(z.string()),
});

const AssessmentRow = z.object({
  outcome_code: z.string(),
  kind: z.enum(["exit", "retention"]),
  score: z.coerce.number(),
  item_results: z.object({ mastered: z.boolean().optional() }).passthrough(),
  taken_at: z.string(),
});

/** Last moment of the deadline day in St. John's. */
export function deadlineEnd(deadline: string): Date {
  const [y, m, d] = deadline.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d, 23, 59, 59, FAMILY_TZ).getTime());
}

export type RewardEvents = { milestones: number; unlocked: number; expired: number };

export async function evaluateRewardsForLearner(learnerId: string, now: Date = new Date()): Promise<RewardEvents> {
  const admin = createAdminClient();
  const [rulesRes, assessRes, profileRes, nameRes] = await Promise.all([
    admin
      .from("reward_rules")
      .select("id, parent_id, learner_id, outcomes, min_score, retention_days, deadline, reward_text, status, misconceptions_at_start, milestones_notified")
      .eq("learner_id", learnerId)
      .eq("status", "active"),
    admin.from("assessments").select("outcome_code, kind, score, item_results, taken_at").eq("learner_id", learnerId),
    admin.from("learner_profiles").select("misconceptions").eq("learner_id", learnerId).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", learnerId).maybeSingle(),
  ]);
  const rules = z.array(RuleRow).parse(rulesRes.data ?? []);
  const assessments: EvalAssessment[] = z
    .array(AssessmentRow)
    .parse(assessRes.data ?? [])
    .map((a) => ({ outcome_code: a.outcome_code, kind: a.kind, score: a.score, mastered: a.item_results.mastered === true, taken_at: a.taken_at }));
  const misconceptionsNow = z.object({ misconceptions: z.array(z.string()) }).safeParse(profileRes.data).data?.misconceptions ?? [];
  const learnerName = z.object({ display_name: z.string() }).safeParse(nameRes.data).data?.display_name ?? "";

  const events: RewardEvents = { milestones: 0, unlocked: 0, expired: 0 };
  const notify = (rows: { recipient_id: string; type: string; payload: Record<string, unknown> }[]) =>
    admin.from("notifications").insert(rows);

  for (const rule of rules) {
    const ev = evaluateRule(rule, assessments, now, deadlineEnd(rule.deadline));
    const base = { rule_id: rule.id, reward_text: rule.reward_text, learner_id: learnerId, learner_name: learnerName };

    const fresh = newMilestones(ev, rule.milestones_notified);
    if (fresh.length) {
      const kind = milestoneKind(ev.achieved.length, rule.outcomes.length);
      const payload = { ...base, outcomes: fresh, achieved: ev.achieved.length, total: rule.outcomes.length, kind };
      await notify([
        { recipient_id: rule.parent_id, type: "milestone", payload },
        { recipient_id: learnerId, type: "milestone", payload },
      ]);
      await admin
        .from("reward_rules")
        .update({ milestones_notified: [...rule.milestones_notified, ...fresh] })
        .eq("id", rule.id);
      events.milestones += 1;
    }

    if (ev.unlock) {
      const praise = praiseSentence({ misconceptionsAtStart: rule.misconceptions_at_start, misconceptionsNow, outcomes: rule.outcomes });
      await admin.from("reward_rules").update({ status: "unlocked", unlocked_at: now.toISOString() }).eq("id", rule.id).eq("status", "active");
      await notify([
        { recipient_id: rule.parent_id, type: "reward_unlocked", payload: { ...base, praise } },
        { recipient_id: learnerId, type: "reward_unlocked", payload: base },
      ]);
      events.unlocked += 1;
    } else if (ev.expire) {
      await admin.from("reward_rules").update({ status: "expired" }).eq("id", rule.id).eq("status", "active");
      await notify([
        { recipient_id: rule.parent_id, type: "reward_expired", payload: base },
        { recipient_id: learnerId, type: "reward_expired", payload: base },
      ]);
      events.expired += 1;
    }
  }
  return events;
}
