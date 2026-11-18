"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getLinkedChildren, requireRole } from "@/lib/auth/dal";
import { passwordSchema } from "@/lib/auth/schemas";
import { RewardRuleInputSchema, isFutureDate } from "@/lib/rewards";
import { SlotInputSchema } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Parent actions. Writes go through the parent's own Supabase session, so
 * Row Level Security and the table triggers check every change; the admin
 * client is used only for the password reset, after the link is verified.
 */

export type PortalState = { error?: "invalid_input" | "past_deadline" | "not_linked" | "save_failed"; ok?: boolean };

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

async function linked(learnerId: string): Promise<boolean> {
  await requireRole("parent");
  return (await getLinkedChildren()).some((c) => c.id === learnerId);
}

function refresh(learnerId: string) {
  revalidatePath(`/parent/child/${learnerId}`, "layout");
  revalidatePath("/learner", "layout");
}

export async function createRewardRule(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const parsed = RewardRuleInputSchema.safeParse({
    learnerId: field(fd, "learnerId"),
    outcomes: fd.getAll("outcomes").filter((v): v is string => typeof v === "string"),
    minScorePercent: field(fd, "minScorePercent"),
    retentionDays: field(fd, "retentionDays") || undefined,
    deadline: field(fd, "deadline"),
    rewardText: field(fd, "rewardText"),
    value: field(fd, "value"),
  });
  if (!parsed.success) return { error: "invalid_input" };
  const r = parsed.data;
  if (!isFutureDate(r.deadline, new Date())) return { error: "past_deadline" };
  if (!(await linked(r.learnerId))) return { error: "not_linked" };

  const user = await requireRole("parent");
  const db = await createClient();
  const res = await db.from("reward_rules").insert({
    parent_id: user.id,
    learner_id: r.learnerId,
    outcomes: r.outcomes,
    min_score: r.minScorePercent / 100,
    retention_days: r.retentionDays,
    deadline: r.deadline,
    reward_text: r.rewardText,
    value: r.value ?? null,
    currency: "CAD",
  });
  if (res.error) return { error: "save_failed" };
  refresh(r.learnerId);
  return { ok: true };
}

const RuleAction = z.object({ ruleId: z.uuid(), learnerId: z.uuid() });

export async function deleteRewardRule(fd: FormData): Promise<void> {
  const p = RuleAction.safeParse({ ruleId: field(fd, "ruleId"), learnerId: field(fd, "learnerId") });
  if (!p.success || !(await linked(p.data.learnerId))) return;
  const db = await createClient();
  await db.from("reward_rules").delete().eq("id", p.data.ruleId);
  refresh(p.data.learnerId);
}

/** Parent marks an unlocked reward as given. No payments in the demo. */
export async function markRewardFulfilled(fd: FormData): Promise<void> {
  const p = RuleAction.safeParse({ ruleId: field(fd, "ruleId"), learnerId: field(fd, "learnerId") });
  if (!p.success || !(await linked(p.data.learnerId))) return;
  const db = await createClient();
  await db.from("reward_rules").update({ status: "fulfilled" }).eq("id", p.data.ruleId).eq("status", "unlocked");
  refresh(p.data.learnerId);
}

export async function addSlot(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const learnerId = field(fd, "learnerId");
  const slot = SlotInputSchema.safeParse({ weekday: field(fd, "weekday"), startTime: field(fd, "startTime"), durationMin: field(fd, "durationMin") });
  if (!slot.success || !z.uuid().safeParse(learnerId).success) return { error: "invalid_input" };
  if (!(await linked(learnerId))) return { error: "not_linked" };
  const db = await createClient();
  const res = await db
    .from("schedules")
    .insert({ learner_id: learnerId, weekday: slot.data.weekday, start_time: slot.data.startTime, duration_min: slot.data.durationMin });
  if (res.error) return { error: "save_failed" };
  refresh(learnerId);
  return { ok: true };
}

export async function removeSlot(fd: FormData): Promise<void> {
  const p = z.object({ slotId: z.uuid(), learnerId: z.uuid() }).safeParse({ slotId: field(fd, "slotId"), learnerId: field(fd, "learnerId") });
  if (!p.success || !(await linked(p.data.learnerId))) return;
  const db = await createClient();
  await db.from("schedules").delete().eq("id", p.data.slotId).eq("learner_id", p.data.learnerId);
  refresh(p.data.learnerId);
}

/** Approve or decline a learner's schedule change request. Approving applies it. */
export async function decideRequest(fd: FormData): Promise<void> {
  const p = z
    .object({ requestId: z.uuid(), learnerId: z.uuid(), decision: z.enum(["approved", "declined"]) })
    .safeParse({ requestId: field(fd, "requestId"), learnerId: field(fd, "learnerId"), decision: field(fd, "decision") });
  if (!p.success || !(await linked(p.data.learnerId))) return;
  const db = await createClient();
  const { data: req } = await db
    .from("schedule_change_requests")
    .select("id, schedule_id, weekday, start_time, duration_min, status")
    .eq("id", p.data.requestId)
    .eq("learner_id", p.data.learnerId)
    .maybeSingle();
  if (!req || req.status !== "pending") return;

  if (p.data.decision === "approved") {
    const slot = { weekday: req.weekday, start_time: req.start_time, duration_min: req.duration_min };
    const applied = req.schedule_id
      ? await db.from("schedules").update(slot).eq("id", req.schedule_id).eq("learner_id", p.data.learnerId)
      : await db.from("schedules").insert({ ...slot, learner_id: p.data.learnerId });
    if (applied.error) return;
  }
  await db.from("schedule_change_requests").update({ status: p.data.decision }).eq("id", req.id);
  refresh(p.data.learnerId);
}

/** Learners have no email, so a linked parent resets their password. */
export async function resetChildPassword(_prev: PortalState, fd: FormData): Promise<PortalState> {
  const learnerId = field(fd, "learnerId");
  const pw = passwordSchema.safeParse(field(fd, "password"));
  if (!pw.success || !z.uuid().safeParse(learnerId).success) return { error: "invalid_input" };
  if (!(await linked(learnerId))) return { error: "not_linked" };
  const res = await createAdminClient().auth.admin.updateUserById(learnerId, { password: pw.data });
  if (res.error) return { error: "save_failed" };
  return { ok: true };
}

export async function markNotificationRead(fd: FormData): Promise<void> {
  const id = z.uuid().safeParse(field(fd, "id"));
  if (!id.success) return;
  await requireRole("parent");
  const db = await createClient();
  await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id.data);
  revalidatePath("/parent", "layout");
}
