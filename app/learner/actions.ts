"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { RewardReplySchema } from "@/lib/rewards";
import { ChangeRequestSchema } from "@/lib/schedule";
import { canLearnerChange, isSharingItem } from "@/lib/sharing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Learner actions. All writes use the learner's own session, so Row Level
 * Security and the table triggers enforce the rules (e.g. locked items).
 */

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

/** Tells every linked parent (in-app notification, §3). */
async function notifyParents(learnerId: string, learnerName: string, type: string, payload: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data: links } = await admin.from("family_links").select("parent_id").eq("learner_id", learnerId);
  const rows = (links ?? []).map((l) => ({
    recipient_id: l.parent_id as string,
    type,
    payload: { learner_id: learnerId, learner_name: learnerName, ...payload },
  }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

/** Turn an unlocked sharing item on or off. Locked items cannot be changed. */
export async function setSharing(fd: FormData): Promise<void> {
  const user = await requireRole("learner");
  const item = field(fd, "item");
  if (!isSharingItem(item) || !canLearnerChange(item)) return;
  const shared = field(fd, "shared") === "true";
  const db = await createClient();
  await db.from("sharing_settings").update({ shared }).eq("learner_id", user.id).eq("item", item);
  revalidatePath("/learner", "layout");
}

export type ReplyState = { error?: "invalid_input" | "save_failed"; ok?: "accepted" | "suggested" };

/** Accept a goal your parent set, or suggest a change in your own words (co-set, §7.4). */
export async function replyToReward(_prev: ReplyState, fd: FormData): Promise<ReplyState> {
  const user = await requireRole("learner");
  const parsed = RewardReplySchema.safeParse({ action: field(fd, "action"), ruleId: field(fd, "ruleId"), note: field(fd, "note") || undefined });
  if (!parsed.success) return { error: "invalid_input" };
  const db = await createClient();
  const update = parsed.data.action === "accept" ? { co_set: true, learner_note: null } : { learner_note: parsed.data.note };
  const res = await db.from("reward_rules").update(update).eq("id", parsed.data.ruleId).eq("learner_id", user.id).select("reward_text").maybeSingle();
  if (res.error || !res.data) return { error: "save_failed" };
  await notifyParents(user.id, user.displayName, parsed.data.action === "accept" ? "reward_accepted" : "reward_suggestion", {
    rule_id: parsed.data.ruleId,
    reward_text: res.data.reward_text,
    ...(parsed.data.action === "suggest" ? { note: parsed.data.note } : {}),
  });
  revalidatePath("/learner", "layout");
  return { ok: parsed.data.action === "accept" ? "accepted" : "suggested" };
}

export type RequestState = { error?: "invalid_input" | "save_failed"; ok?: boolean };

/** Ask a parent to change a study time (or add one). The parent approves (§7.6). */
export async function requestScheduleChange(_prev: RequestState, fd: FormData): Promise<RequestState> {
  const user = await requireRole("learner");
  const parsed = ChangeRequestSchema.safeParse({
    scheduleId: field(fd, "scheduleId"),
    weekday: field(fd, "weekday"),
    startTime: field(fd, "startTime"),
    durationMin: field(fd, "durationMin"),
    note: field(fd, "note") || undefined,
  });
  if (!parsed.success) return { error: "invalid_input" };
  const r = parsed.data;
  const db = await createClient();
  const res = await db.from("schedule_change_requests").insert({
    learner_id: user.id,
    schedule_id: r.scheduleId || null,
    weekday: r.weekday,
    start_time: r.startTime,
    duration_min: r.durationMin,
    note: r.note ?? null,
  });
  if (res.error) return { error: "save_failed" };
  await notifyParents(user.id, user.displayName, "schedule_request", { weekday: r.weekday, start_time: r.startTime, duration_min: r.durationMin });
  revalidatePath("/learner", "layout");
  return { ok: true };
}
