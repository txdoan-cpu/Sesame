import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLinkedChildren, requireRole, type LinkedChild } from "@/lib/auth/dal";
import { SHARING_ITEMS, type SharingItem } from "@/lib/sharing";
import { rewardProgress } from "@/lib/rewards";
import { sortSlots, type Slot } from "@/lib/schedule";
import type { OutcomeStatusKind } from "@/lib/learner-profile";
import { weekStart } from "@/lib/time";
import { buildWeeklySummary, type WeeklySummary } from "@/lib/weekly";
import { getLessonForOutcome } from "@/lib/lesson/registry";
import { fitScore } from "@/lib/lesson/fit";

/**
 * What a parent may see about a child (CLAUDE.md §6, §7.3). Everything about
 * the child is read through the sharing-aware views; a learner reading the
 * same views gets exactly the same answer ("What my parent sees").
 */

export async function requireLinkedChild(learnerId: string): Promise<LinkedChild> {
  await requireRole("parent");
  const child = (await getLinkedChildren()).find((c) => c.id === learnerId);
  if (!child) redirect("/parent");
  return child;
}

export type SharingState = Record<SharingItem, { shared: boolean; locked: boolean }>;

export type ChildView = {
  sharing: SharingState;
  /** null = the child keeps this private */
  outcomeStatus: { outcome_code: string; status: OutcomeStatusKind; mastery: number | null }[] | null;
  scores: { id: string; outcome_code: string; kind: string; score: number; mastered: boolean; taken_at: string }[] | null;
  questions: { id: string; slide_no: number | null; text: string; indicator: string | null; created_at: string }[] | null;
  misconceptions: string[] | null;
  attendance: { id: string; scheduled_for: string | null; started_at: string | null; active_seconds: number; idle_seconds: number; engagement: string | null }[];
};

const SharingRow = z.object({ item: z.string(), shared: z.boolean(), locked: z.boolean() });

export async function getChildView(learnerId: string): Promise<ChildView> {
  const db = await createClient();
  const sharingRes = await db.from("sharing_v").select("item, shared, locked").eq("learner_id", learnerId);
  const rows = z.array(SharingRow).safeParse(sharingRes.data).data ?? [];
  const sharing = Object.fromEntries(
    SHARING_ITEMS.map((s) => {
      const row = rows.find((r) => r.item === s.item);
      return [s.item, { shared: row ? row.shared : s.defaultShared, locked: s.locked }];
    }),
  ) as SharingState;

  const ifShared = async <T,>(item: SharingItem, load: () => Promise<T>): Promise<T | null> => (sharing[item].shared ? load() : null);

  const [outcomeStatus, scores, questions, misconceptions, attendance] = await Promise.all([
    ifShared("outcome_status", async () => {
      const r = await db.from("parent_outcome_status_v").select("outcome_code, status, mastery").eq("learner_id", learnerId);
      return z
        .array(z.object({ outcome_code: z.string(), status: z.enum(["not_started", "learning", "nearly", "achieved", "retained"]), mastery: z.coerce.number().nullable() }))
        .parse(r.data ?? []);
    }),
    ifShared("scores", async () => {
      const r = await db
        .from("parent_scores_v")
        .select("id, outcome_code, kind, score, mastered, taken_at")
        .eq("learner_id", learnerId)
        .order("taken_at", { ascending: false })
        .limit(20);
      return z
        .array(z.object({ id: z.string(), outcome_code: z.string(), kind: z.string(), score: z.coerce.number(), mastered: z.boolean(), taken_at: z.string() }))
        .parse(r.data ?? []);
    }),
    ifShared("question_summaries", async () => {
      const r = await db
        .from("parent_questions_v")
        .select("id, slide_no, text, indicator, created_at")
        .eq("learner_id", learnerId)
        .order("created_at", { ascending: false })
        .limit(20);
      return z
        .array(z.object({ id: z.string(), slide_no: z.number().nullable(), text: z.string(), indicator: z.string().nullable(), created_at: z.string() }))
        .parse(r.data ?? []);
    }),
    ifShared("misconceptions", async () => {
      const r = await db.from("parent_misconceptions_v").select("misconceptions").eq("learner_id", learnerId).maybeSingle();
      return z.object({ misconceptions: z.array(z.string()) }).safeParse(r.data).data?.misconceptions ?? [];
    }),
    // Attendance is locked (always shared).
    (async () => {
      const r = await db
        .from("parent_attendance_v")
        .select("id, scheduled_for, started_at, active_seconds, idle_seconds, engagement")
        .eq("learner_id", learnerId)
        .order("started_at", { ascending: false })
        .limit(10);
      return z
        .array(
          z.object({
            id: z.string(),
            scheduled_for: z.string().nullable(),
            started_at: z.string().nullable(),
            active_seconds: z.number(),
            idle_seconds: z.number(),
            engagement: z.string().nullable(),
          }),
        )
        .parse(r.data ?? []);
    })(),
  ]);

  return { sharing, outcomeStatus, scores, questions, misconceptions, attendance };
}

const RuleRow = z.object({
  id: z.string(),
  learner_id: z.string(),
  outcomes: z.array(z.string()),
  min_score: z.coerce.number(),
  retention_days: z.number(),
  deadline: z.string(),
  reward_text: z.string(),
  value: z.coerce.number().nullable(),
  currency: z.string(),
  co_set: z.boolean(),
  learner_note: z.string().nullable(),
  status: z.enum(["active", "unlocked", "fulfilled", "expired"]),
  created_at: z.string(),
});

export type RewardRuleView = z.infer<typeof RuleRow> & {
  progress: { achieved: number; total: number; percent: number };
  achievedOutcomes: string[];
};

/** Reward goals for a child, with achieved/not progress from the locked reward_progress view. */
export async function getRewardRules(learnerId: string): Promise<RewardRuleView[]> {
  const db = await createClient();
  const [rules, progress] = await Promise.all([
    db
      .from("reward_rules")
      .select("id, learner_id, outcomes, min_score, retention_days, deadline, reward_text, value, currency, co_set, learner_note, status, created_at")
      .eq("learner_id", learnerId)
      .order("created_at", { ascending: false }),
    db.from("parent_reward_progress_v").select("rule_id, outcome_code, achieved").eq("learner_id", learnerId),
  ]);
  const prog = z.array(z.object({ rule_id: z.string(), outcome_code: z.string(), achieved: z.boolean() })).parse(progress.data ?? []);
  return z
    .array(RuleRow)
    .parse(rules.data ?? [])
    .map((r) => {
      const mine = prog.filter((p) => p.rule_id === r.id);
      return {
        ...r,
        progress: rewardProgress(r.outcomes.map((o) => mine.some((p) => p.outcome_code === o && p.achieved))),
        achievedOutcomes: mine.filter((p) => p.achieved).map((p) => p.outcome_code),
      };
    });
}

const SlotRow = z.object({ id: z.string(), weekday: z.number(), start_time: z.string(), duration_min: z.number(), active: z.boolean() });

export async function getSchedule(learnerId: string): Promise<Slot[]> {
  const db = await createClient();
  const r = await db.from("schedules").select("id, weekday, start_time, duration_min, active").eq("learner_id", learnerId);
  return sortSlots(z.array(SlotRow).parse(r.data ?? []));
}

const RequestRow = z.object({
  id: z.string(),
  schedule_id: z.string().nullable(),
  weekday: z.number(),
  start_time: z.string(),
  duration_min: z.number(),
  note: z.string().nullable(),
  status: z.enum(["pending", "approved", "declined"]),
  created_at: z.string(),
});
export type ChangeRequest = z.infer<typeof RequestRow>;

export async function getChangeRequests(learnerId: string): Promise<ChangeRequest[]> {
  const db = await createClient();
  const r = await db
    .from("schedule_change_requests")
    .select("id, schedule_id, weekday, start_time, duration_min, note, status, created_at")
    .eq("learner_id", learnerId)
    .order("created_at", { ascending: false })
    .limit(20);
  return z.array(RequestRow).parse(r.data ?? []);
}

const NotificationRow = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type NotificationView = z.infer<typeof NotificationRow>;

/** The signed-in user's own notifications (safety alerts, schedule requests, …). */
export async function getMyNotifications(): Promise<NotificationView[]> {
  const db = await createClient();
  const r = await db.from("notifications").select("id, type, payload, read_at, created_at").order("created_at", { ascending: false }).limit(50);
  return z.array(NotificationRow).parse(r.data ?? []);
}

/**
 * "This week" for a child, read through the same sharing-aware views
 * (so the learner's preview shows the same numbers).
 */
export async function getThisWeek(learnerId: string, at?: Date): Promise<WeeklySummary> {
  const db = await createClient();
  const now = at ?? new Date(); // after the request-time access above
  const since = weekStart(now).toISOString();
  const [sharingRes, sessions, slots, rewards] = await Promise.all([
    db.from("sharing_v").select("item, shared").eq("learner_id", learnerId).eq("item", "outcome_status").maybeSingle(),
    db.from("parent_attendance_v").select("scheduled_for, started_at, active_seconds, idle_seconds, engagement").eq("learner_id", learnerId).gte("started_at", since),
    getSchedule(learnerId),
    getRewardRules(learnerId),
  ]);
  const outcomesShared = sharingRes.data?.shared !== false;
  let outcomesAchieved: string[] | null = null;
  if (outcomesShared) {
    const r = await db.from("parent_outcome_status_v").select("outcome_code, achieved_at").eq("learner_id", learnerId).gte("achieved_at", since);
    outcomesAchieved = (r.data ?? []).map((x) => x.outcome_code as string);
  }
  return buildWeeklySummary({
    now,
    slots,
    sessions: z
      .array(z.object({ scheduled_for: z.string().nullable(), started_at: z.string().nullable(), active_seconds: z.number(), idle_seconds: z.number(), engagement: z.string().nullable() }))
      .parse(sessions.data ?? []),
    rewards: rewards.map((r) => ({ reward_text: r.reward_text, achieved: r.progress.achieved, total: r.progress.total, status: r.status })),
    outcomesAchieved,
  });
}

export type RationaleView = {
  outcome: string;
  lessonTitle: string;
  fitScore: number;
  gatePassed: boolean;
  rows: { criteria: string[]; signal: { en: string; vi: string }; method: { en: string; vi: string } }[];
  /** Rows not shown because they rest on something the learner keeps private. */
  hidden: number;
};

/**
 * "Why this lesson" card for a child (proposal: rationale card). Reasons based
 * on mastery follow outcome_status sharing; reasons based on mistakes or math
 * anxiety follow misconceptions sharing (private by default).
 */
export async function getRationale(learnerId: string, sharing: SharingState): Promise<RationaleView | null> {
  const lesson = getLessonForOutcome("8PR2");
  const r = lesson?.rationale;
  if (!lesson || !r) return null;
  const visible = r.rows.filter((row) => row.requires === null || sharing[row.requires].shared);
  return {
    outcome: lesson.outcome_code,
    lessonTitle: lesson.title,
    fitScore: fitScore(r.criteria_scores),
    gatePassed: r.gate_passed,
    rows: visible.map((row) => ({
      criteria: row.criteria,
      signal: { en: row.signal_en, vi: row.signal_vi },
      method: { en: row.method_en, vi: row.method_vi },
    })),
    hidden: r.rows.length - visible.length,
  };
}
