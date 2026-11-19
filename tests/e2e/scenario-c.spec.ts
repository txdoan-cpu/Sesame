import { expect, test } from "@playwright/test";
import { format } from "date-fns";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { localNow } from "@/lib/time";
import { QUICK_SPEECH, answer, expectSlide, loginLearner, loginParent, walkSlides } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Demo scenario C (proposal): during a scheduled session the learner stops answering a
// check-in. After 60 s the lesson pauses and asks "Are you still there?" out loud. After
// 5 more minutes the parent gets an alert with the slide and active minutes. When the
// learner comes back, the lesson resumes at the same slide with a short review question.

test.describe("demo scenario C: walking away mid-session", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "scc");
    // A study slot that is happening right now in St. John's.
    const local = localNow(new Date(Date.now() - 5 * 60_000));
    const seed = await Promise.all([
      admin.from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), fam.learner.id)),
      admin.from("schedules").insert({ learner_id: fam.learner.id, weekday: local.getDay(), start_time: format(local, "HH:mm"), duration_min: 90 }),
    ]);
    for (const r of seed) if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("pause after 60 s, parent alert after 5 min away, resume with a review question", async ({ page, browser }) => {
    await page.addInitScript(QUICK_SPEECH);
    await page.clock.install();
    await loginLearner(page, fam.learner.username);
    await page.goto("/learner/lesson");
    await page.getByRole("button", { name: "Start lesson" }).click();

    // Work normally up to slide 4, then stop answering its check-in.
    await walkSlides(page, 4);
    await expect(page.getByTestId("check-s4")).toBeVisible();

    await page.clock.runFor(30_000);
    await expect(page.getByTestId("still-there")).toHaveCount(0);
    await page.clock.runFor(35_000);
    const prompt = page.getByTestId("still-there");
    await expect(prompt).toContainText("Are you still there?");
    await expect(prompt).toContainText("paused at slide 4");

    // Five more minutes away during a scheduled session → the parent is alerted.
    await page.clock.runFor(5 * 60_000 + 30_000);
    const admin = adminClient();
    await expect
      .poll(async () => (await admin.from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "idle")).data ?? [], {
        timeout: 15_000,
      })
      .toHaveLength(1);
    const alert = (await admin.from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "idle").single()).data!;
    expect(alert.payload).toMatchObject({ slide_no: 4, learner_id: fam.learner.id });
    expect((alert.payload as { away_minutes: number }).away_minutes).toBeGreaterThanOrEqual(5);

    // The parent sees it in plain words.
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto("/parent/notifications");
    await expect(parent.getByTestId("notification-idle")).toContainText(`${fam.learner.name}'s session paused at slide 4`);

    // The learner comes back: a short review question, then the same slide.
    await page.getByRole("button", { name: "I'm back" }).click();
    const review = page.getByTestId("review");
    await expect(review).toContainText("Quick review");
    await review.getByRole("textbox").fill("5");
    await review.getByRole("button", { name: "Check" }).click();
    await review.getByRole("button", { name: "Continue the lesson" }).click();
    await expectSlide(page, 4);
    await answer(page, "s4", "5");

    // The session is recorded as scheduled, with the alert and the pause/resume events.
    await page.clock.runFor(16_000);
    await expect
      .poll(async () => {
        const s = await admin.from("sessions").select("id, scheduled_for, away_alert_sent_at, idle_seconds").eq("learner_id", fam.learner.id).single();
        const ev = await admin.from("events").select("type").eq("session_id", s.data!.id);
        return {
          scheduled: Boolean(s.data?.scheduled_for),
          alerted: Boolean(s.data?.away_alert_sent_at),
          idleOver5min: (s.data?.idle_seconds ?? 0) >= 300,
          events: [...new Set((ev.data ?? []).map((e) => e.type))].sort(),
        };
      }, { timeout: 15_000 })
      .toMatchObject({ scheduled: true, alerted: true, idleOver5min: true, events: expect.arrayContaining(["checkpoint_answer", "paused", "resume"]) });
  });
});
