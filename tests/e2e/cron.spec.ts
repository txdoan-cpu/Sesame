import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_CRON_SECRET, loginParent } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Scheduled checks (/api/cron/engagement): missed sessions with a make-up proposal (§7.6),
// sessions abandoned with the tab closed, reward deadlines, and the weekly report.
// The test server allows moving the clock and limiting the sweep to these families.

async function sweep(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post("/api/cron/engagement", {
    headers: { authorization: `Bearer ${E2E_CRON_SECRET}` },
    data: body,
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, number>;
}

test.describe("scheduled checks", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;
  // Wednesday 18 Nov 2026, 19:30 in St. John's.
  const WED_1930 = "2026-11-18T23:00:00.000Z";

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "cron");
    // Wednesday 18:00 for 30 min: over by 19:30, and nobody studied.
    const r = await admin.from("schedules").insert({ learner_id: fam.learner.id, weekday: 3, start_time: "18:00", duration_min: 30 });
    if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("refuses callers without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/engagement")).status()).toBe(401);
    expect((await request.get("/api/cron/engagement", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
  });

  test("missed session: the parent is told once, with a make-up proposal", async ({ request, page }) => {
    const scope = { learnerIds: [fam.learner.id], now: WED_1930 };
    expect((await sweep(request, scope)).missedSessions).toBe(1);
    expect((await sweep(request, scope)).missedSessions).toBe(0); // idempotent

    const n = await adminClient().from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "missed_session");
    expect(n.data).toHaveLength(1);
    expect(n.data?.[0].payload).toMatchObject({ weekday: 3, start_time: "18:00", make_up: { weekday: 4, start_time: "18:00" } });

    await loginParent(page, fam.parent.email);
    await page.goto("/parent/notifications");
    await expect(page.getByTestId("notification-missed_session")).toContainText(
      `${fam.learner.name} missed the Wednesday 18:00 study session. Suggested make-up: Thursday at 18:00.`,
    );
  });

  test("weekly report: in-app summary for the parent, sent once a week", async ({ request, page }) => {
    const body = { learnerIds: [fam.learner.id], now: WED_1930, forceWeekly: true };
    expect((await sweep(request, body)).weeklyReports).toBe(1);
    expect((await sweep(request, body)).weeklyReports).toBe(0);
    const n = await adminClient().from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "weekly_summary").single();
    expect(n.data?.payload).toMatchObject({ week: "2026-11-16", scheduled: 1, attended: 0, activeMinutes: 0 });

    await loginParent(page, fam.parent.email);
    await page.goto("/parent/notifications");
    await expect(page.getByTestId("notification-weekly_summary")).toContainText("0 of 1 scheduled sessions");
  });

  test("a scheduled session left open with the tab closed alerts the parent and is closed", async ({ request }) => {
    const admin = adminClient();
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const s = await admin
      .from("sessions")
      .insert({ learner_id: fam.learner.id, lesson_id: "8PR2-demo-A", scheduled_for: tenMinAgo, started_at: tenMinAgo, last_heartbeat_at: tenMinAgo, slide_no: 6, active_seconds: 420 })
      .select("id")
      .single();
    expect((await sweep(request, { learnerIds: [fam.learner.id] })).staleSessionAlerts).toBe(1);
    const after = await admin.from("sessions").select("ended_at, engagement, away_alert_sent_at").eq("id", s.data!.id).single();
    expect(after.data?.ended_at).toBeTruthy();
    expect(after.data?.away_alert_sent_at).toBeTruthy();
    const idle = await admin.from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "idle").single();
    expect(idle.data?.payload).toMatchObject({ slide_no: 6, active_minutes: 7 });
    expect((await sweep(request, { learnerIds: [fam.learner.id] })).staleSessionAlerts).toBe(0);
  });

  test("a goal past its deadline expires and both sides are told", async ({ request }) => {
    const admin = adminClient();
    const r = await admin
      .from("reward_rules")
      .insert({ parent_id: fam.parent.id, learner_id: fam.learner.id, outcomes: ["8PR2"], min_score: 0.8, deadline: "2026-11-01", reward_text: "Old goal" })
      .select("id")
      .single();
    expect((await sweep(request, { learnerIds: [fam.learner.id] })).expiredRewards).toBe(1);
    expect((await admin.from("reward_rules").select("status").eq("id", r.data!.id).single()).data?.status).toBe("expired");
    const told = await admin.from("notifications").select("recipient_id").eq("type", "reward_expired").eq("payload->>rule_id", r.data!.id);
    expect(new Set(told.data?.map((x) => x.recipient_id))).toEqual(new Set([fam.parent.id, fam.learner.id]));
  });
});
