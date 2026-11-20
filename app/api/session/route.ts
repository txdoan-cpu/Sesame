import { connection } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { classifyEngagement, clampHeartbeat, shouldSendAwayAlert } from "@/lib/engagement";
import { refreshProfile } from "@/lib/learner/model";
import { lessonForLearner } from "@/lib/lesson/library";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSlot } from "@/lib/time";

// POST /api/session: lesson session start / heartbeat / end, plus engagement events (§7.5).
// Writes use the service role after checking the session belongs to the signed-in learner.

const EventSchema = z.object({
  type: z.enum(["checkpoint_answer", "question", "idle_start", "idle_end", "tab_hidden", "tab_visible", "resume", "paused"]),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

const InputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), lessonId: z.string().max(100) }),
  z.object({
    action: z.literal("heartbeat"),
    sessionId: z.uuid(),
    activeDelta: z.number().min(0).max(3600),
    idleDelta: z.number().min(0).max(3600),
    slideNo: z.number().int().min(0).max(50),
    /** Seconds the learner has been away right now (0 when active). */
    awaySeconds: z.number().min(0).max(86_400),
    paused: z.boolean().default(false),
    events: z.array(EventSchema).max(50).default([]),
  }),
  z.object({ action: z.literal("end"), sessionId: z.uuid() }),
]);

export type SessionStartResponse = { ok: true; sessionId: string; scheduled: boolean } | { ok: false; code: string };

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await connection();
  const user = await getCurrentUser();
  if (!user || user.role !== "learner") return reply({ ok: false, code: "not_signed_in" }, 401);

  // sendBeacon posts text/plain; parse the body ourselves.
  const raw = await request.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // fall through to validation error
  }
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) return reply({ ok: false, code: "invalid_input" }, 400);
  const input = parsed.data;
  const admin = createAdminClient();
  const now = new Date();

  if (input.action === "start") {
    if (!(await lessonForLearner(user.id, input.lessonId))) return reply({ ok: false, code: "invalid_input" }, 400);
    const { data: slots } = await admin
      .from("schedules")
      .select("id, weekday, start_time, duration_min, active")
      .eq("learner_id", user.id);
    const match = currentSlot(slots ?? [], now);
    const { data, error } = await admin
      .from("sessions")
      .insert({
        learner_id: user.id,
        lesson_id: input.lessonId,
        started_at: now.toISOString(),
        last_heartbeat_at: now.toISOString(),
        schedule_id: match?.slot.id ?? null,
        scheduled_for: match?.start.toISOString() ?? null,
        slide_no: 1,
      })
      .select("id")
      .single();
    if (error || !data) return reply({ ok: false, code: "save_failed" }, 500);
    return reply({ ok: true, sessionId: data.id, scheduled: Boolean(match) } satisfies SessionStartResponse);
  }

  const { data: session } = await admin
    .from("sessions")
    .select("id, learner_id, active_seconds, idle_seconds, scheduled_for, away_alert_sent_at, ended_at")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (!session || session.learner_id !== user.id) return reply({ ok: false, code: "not_found" }, 404);
  if (session.ended_at) return reply({ ok: true, ended: true });

  if (input.action === "end") {
    await admin
      .from("sessions")
      .update({ ended_at: now.toISOString(), engagement: classifyEngagement(session.active_seconds, session.idle_seconds) })
      .eq("id", session.id);
    // §7.8: recompute learner_profiles after each session.
    try {
      await refreshProfile(user.id, now);
    } catch (err) {
      console.error("refresh learner profile failed:", err instanceof Error ? err.message : err);
    }
    return reply({ ok: true });
  }

  // Add time atomically: heartbeats can arrive together.
  const delta = clampHeartbeat(input.activeDelta, input.idleDelta);
  const totals = await admin
    .rpc("session_heartbeat", { p_session: session.id, p_active: delta.active, p_idle: delta.idle, p_slide: input.slideNo, p_paused: input.paused })
    .single<{ active_seconds: number; idle_seconds: number }>();
  const active = totals.data?.active_seconds ?? session.active_seconds + delta.active;
  const idle = totals.data?.idle_seconds ?? session.idle_seconds + delta.idle;
  await admin.from("sessions").update({ engagement: classifyEngagement(active, idle) }).eq("id", session.id);

  // Only one heartbeat may claim the alert, even if several arrive at once.
  const alert =
    shouldSendAwayAlert({ scheduled: session.scheduled_for !== null, awaySeconds: input.awaySeconds, alreadySent: session.away_alert_sent_at !== null }) &&
    (await admin.rpc("claim_away_alert", { p_session: session.id })).data === true;

  if (input.events.length) {
    await admin
      .from("events")
      .insert(input.events.map((e) => ({ session_id: session.id, learner_id: user.id, type: e.type, payload: e.payload })));
  }

  if (alert) {
    // Attendance is locked (always shared): tell every linked parent.
    const { data: links } = await admin.from("family_links").select("parent_id").eq("learner_id", user.id);
    const rows = (links ?? []).map((l) => ({
      recipient_id: l.parent_id as string,
      type: "idle",
      payload: {
        learner_id: user.id,
        learner_name: user.displayName,
        session_id: session.id,
        slide_no: input.slideNo,
        active_minutes: Math.round(active / 60),
        away_minutes: Math.floor(input.awaySeconds / 60),
      },
    }));
    if (rows.length) await admin.from("notifications").insert(rows);
  }

  return reply({ ok: true, alertSent: alert });
}
