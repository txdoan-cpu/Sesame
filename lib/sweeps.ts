import "server-only";
import { z } from "zod";
import { classifyEngagement, AWAY_ALERT_MS } from "@/lib/engagement";
import { evaluateRewardsForLearner } from "@/lib/rewards-service";
import { effectiveSharing } from "@/lib/sharing";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDate, localNow, proposeMakeUp, slotsEndedToday, weekKey, weekStart } from "@/lib/time";
import { buildWeeklySummary } from "@/lib/weekly";
import { sendEmail } from "@/lib/email";

/**
 * Scheduled checks (run by /api/cron/engagement). Each step is idempotent:
 * running it twice sends nothing twice.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Optional limit to some learners (tests use it so they never touch other families). */
export type Scope = string[] | undefined;

async function parentsOf(admin: Admin, learnerId: string): Promise<string[]> {
  const { data } = await admin.from("family_links").select("parent_id").eq("learner_id", learnerId);
  return (data ?? []).map((r) => r.parent_id as string);
}

async function nameOf(admin: Admin, id: string): Promise<string> {
  const { data } = await admin.from("profiles").select("display_name").eq("id", id).maybeSingle();
  return (data?.display_name as string | undefined) ?? "";
}

/** A tab closed mid-session sends no more heartbeats: close it, and alert if it was scheduled. */
export async function sweepStaleSessions(admin: Admin, now: Date, scope?: Scope): Promise<number> {
  const cutoff = new Date(now.getTime() - AWAY_ALERT_MS).toISOString();
  let q = admin
    .from("sessions")
    .select("id, learner_id, scheduled_for, slide_no, active_seconds, idle_seconds, last_heartbeat_at, away_alert_sent_at")
    .is("ended_at", null)
    .lt("last_heartbeat_at", cutoff);
  if (scope) q = q.in("learner_id", scope);
  const { data } = await q;
  let alerts = 0;
  for (const s of data ?? []) {
    if (s.scheduled_for && !s.away_alert_sent_at) {
      const name = await nameOf(admin, s.learner_id);
      const rows = (await parentsOf(admin, s.learner_id)).map((p) => ({
        recipient_id: p,
        type: "idle",
        payload: { learner_id: s.learner_id, learner_name: name, session_id: s.id, slide_no: s.slide_no, active_minutes: Math.round(s.active_seconds / 60), away_minutes: 5 },
      }));
      if (rows.length) await admin.from("notifications").insert(rows);
      alerts++;
    }
    await admin
      .from("sessions")
      .update({
        ended_at: s.last_heartbeat_at,
        engagement: classifyEngagement(s.active_seconds, s.idle_seconds),
        away_alert_sent_at: s.scheduled_for && !s.away_alert_sent_at ? now.toISOString() : s.away_alert_sent_at,
      })
      .eq("id", s.id);
  }
  return alerts;
}

const SlotRow = z.object({ id: z.string(), learner_id: z.string(), weekday: z.number(), start_time: z.string(), duration_min: z.number(), active: z.boolean() });

/** A slot that ended today with no session in its window → tell the parent and propose a make-up (§7.6). */
export async function sweepMissedSessions(admin: Admin, now: Date, scope?: Scope): Promise<number> {
  let q = admin.from("schedules").select("id, learner_id, weekday, start_time, duration_min, active").eq("active", true);
  if (scope) q = q.in("learner_id", scope);
  const { data } = await q;
  const slots = z.array(SlotRow).parse(data ?? []);
  const today = localDate(now);
  let sent = 0;
  for (const { slot, start, end } of slotsEndedToday(slots, now)) {
    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("learner_id", slot.learner_id)
      .gte("started_at", new Date(start.getTime() - 30 * 60_000).toISOString())
      .lte("started_at", end.toISOString())
      .limit(1);
    if (sessions?.length) continue;
    const parents = await parentsOf(admin, slot.learner_id);
    if (!parents.length) continue;
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "missed_session")
      .eq("payload->>schedule_id", slot.id)
      .eq("payload->>date", today)
      .limit(1);
    if (existing?.length) continue;
    const learnerSlots = slots.filter((s) => s.learner_id === slot.learner_id);
    const makeUp = proposeMakeUp(slot, learnerSlots);
    const name = await nameOf(admin, slot.learner_id);
    await admin.from("notifications").insert(
      parents.map((p) => ({
        recipient_id: p,
        type: "missed_session",
        payload: {
          learner_id: slot.learner_id,
          learner_name: name,
          schedule_id: slot.id,
          date: today,
          weekday: slot.weekday,
          start_time: slot.start_time.slice(0, 5),
          make_up: makeUp,
        },
      })),
    );
    sent++;
  }
  return sent;
}

/** Deadlines pass without anyone taking a test: evaluate learners with active goals. */
export async function sweepRewardDeadlines(admin: Admin, now: Date, scope?: Scope): Promise<number> {
  let q = admin.from("reward_rules").select("learner_id").eq("status", "active");
  if (scope) q = q.in("learner_id", scope);
  const { data } = await q;
  const learners = [...new Set((data ?? []).map((r) => r.learner_id as string))];
  let expired = 0;
  for (const id of learners) expired += (await evaluateRewardsForLearner(id, now)).expired;
  return expired;
}

/** Sunday from 6 pm local: one weekly report per parent and child, in-app (+ email when configured). */
export async function sweepWeeklyReports(admin: Admin, now: Date, force = false, scope?: Scope): Promise<number> {
  const local = localNow(now);
  if (!force && !(local.getDay() === 0 && local.getHours() >= 18)) return 0;
  const week = weekKey(now);
  const since = weekStart(now).toISOString();
  let lq = admin.from("family_links").select("parent_id, learner_id");
  if (scope) lq = lq.in("learner_id", scope);
  const { data: links } = await lq;
  let sent = 0;
  for (const link of links ?? []) {
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("recipient_id", link.parent_id)
      .eq("type", "weekly_summary")
      .eq("payload->>learner_id", link.learner_id)
      .eq("payload->>week", week)
      .limit(1);
    if (existing?.length) continue;

    const [slots, sessions, rules, sharingRows, statuses] = await Promise.all([
      admin.from("schedules").select("id, weekday, start_time, duration_min, active").eq("learner_id", link.learner_id),
      admin.from("sessions").select("scheduled_for, started_at, active_seconds, idle_seconds, engagement").eq("learner_id", link.learner_id).gte("started_at", since),
      admin.from("reward_rules").select("reward_text, outcomes, status").eq("learner_id", link.learner_id).eq("parent_id", link.parent_id),
      admin.from("sharing_settings").select("item, shared").eq("learner_id", link.learner_id),
      admin.from("outcome_status").select("outcome_code, status, achieved_at").eq("learner_id", link.learner_id),
    ]);
    const sharing = effectiveSharing(sharingRows.data ?? []);
    const statusRows = statuses.data ?? [];
    const achievedSet = new Set(statusRows.filter((s) => s.status === "achieved" || s.status === "retained").map((s) => s.outcome_code as string));
    const summary = buildWeeklySummary({
      now,
      slots: slots.data ?? [],
      sessions: sessions.data ?? [],
      // Reward progress is locked (achieved / not only).
      rewards: (rules.data ?? []).map((r) => ({
        reward_text: r.reward_text as string,
        achieved: (r.outcomes as string[]).filter((o) => achievedSet.has(o)).length,
        total: (r.outcomes as string[]).length,
        status: r.status as string,
      })),
      outcomesAchieved: sharing.outcome_status
        ? statusRows.filter((s) => s.achieved_at && s.achieved_at >= since).map((s) => s.outcome_code as string)
        : null,
    });
    const name = await nameOf(admin, link.learner_id);
    await admin.from("notifications").insert({
      recipient_id: link.parent_id,
      type: "weekly_summary",
      payload: { learner_id: link.learner_id, learner_name: name, ...summary },
    });
    const { data: parentUser } = await admin.auth.admin.getUserById(link.parent_id);
    if (parentUser.user?.email) {
      await sendEmail({
        to: parentUser.user.email,
        subject: `Weekly report for ${name}`,
        text: `${name} studied ${summary.attended} of ${summary.scheduled} scheduled sessions this week, with ${summary.activeMinutes} minutes of active study. Open the parent dashboard for details.`,
      });
    }
    sent++;
  }
  return sent;
}

export async function runSweeps(now: Date, options: { forceWeekly?: boolean; scope?: Scope } = {}) {
  const admin = createAdminClient();
  return {
    staleSessionAlerts: await sweepStaleSessions(admin, now, options.scope),
    missedSessions: await sweepMissedSessions(admin, now, options.scope),
    expiredRewards: await sweepRewardDeadlines(admin, now, options.scope),
    weeklyReports: await sweepWeeklyReports(admin, now, options.forceWeekly, options.scope),
  };
}
