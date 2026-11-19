import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/dal";

/** §6: "retained" needs a second check ≥ 14 days after achieving. */
export const RETAINED_AFTER_DAYS = 14;
const DAY_MS = 86_400_000;

export type RetentionDue = { outcome: string; achievedAt: string; dueAt: string; ready: boolean };

/**
 * Outcomes the signed-in learner has achieved, and when their memory check is
 * due: the earliest of an active reward goal's retention_days, or 14 days.
 */
export async function getMyRetentionChecks(at?: Date): Promise<RetentionDue[]> {
  const user = await requireRole("learner");
  // Read the clock only after the request-time data access (prerendering stops there).
  const now = at ?? new Date();
  const db = await createClient();
  const [statuses, rules, checks] = await Promise.all([
    db.from("outcome_status").select("outcome_code, status, achieved_at").eq("learner_id", user.id).in("status", ["achieved"]),
    db.from("reward_rules").select("outcomes, retention_days").eq("learner_id", user.id).eq("status", "active"),
    db.from("assessments").select("outcome_code, kind, taken_at").eq("learner_id", user.id).eq("kind", "retention"),
  ]);
  const st = z.array(z.object({ outcome_code: z.string(), achieved_at: z.string().nullable() })).parse(statuses.data ?? []);
  const rs = z.array(z.object({ outcomes: z.array(z.string()), retention_days: z.number() })).parse(rules.data ?? []);
  const done = z.array(z.object({ outcome_code: z.string(), taken_at: z.string() })).parse(checks.data ?? []);

  return st.flatMap((s) => {
    if (!s.achieved_at) return [];
    const achieved = new Date(s.achieved_at).getTime();
    // Each reason for a check (a goal's retention days, then 14 days), soonest first.
    const reasons = [...new Set([...rs.filter((r) => r.outcomes.includes(s.outcome_code)).map((r) => r.retention_days), RETAINED_AFTER_DAYS])].sort(
      (a, b) => a - b,
    );
    // The first reason not yet covered by a check taken after it was due.
    const days = reasons.find((d) => !done.some((c) => c.outcome_code === s.outcome_code && new Date(c.taken_at).getTime() >= achieved + d * DAY_MS));
    if (days === undefined) return [];
    const due = new Date(achieved + days * DAY_MS);
    return [{ outcome: s.outcome_code, achievedAt: s.achieved_at, dueAt: due.toISOString(), ready: now >= due }];
  });
}
