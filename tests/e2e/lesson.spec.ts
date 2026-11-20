import { DEFAULT_PARAMS, replay } from "@/lib/learner/bkt";
import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";
import { loginLearner } from "./helpers/lesson";

// Round 3 "done when": finishing the lesson updates outcome_status and mastery.

test.describe("lesson player", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;
  let unsure: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "les");
    unsure = await createFamily(admin, "les2");
    const profile = LearnerProfileSchema.parse(demoA);
    const rows = [
      toLearnerProfileRow(profile, fam.learner.id),
      toLearnerProfileRow({ ...profile, confidence_of_estimate: 0.5 }, unsure.learner.id),
    ];
    const p = await admin.from("learner_profiles").insert(rows);
    if (p.error) throw new Error(p.error.message);
    const s = await admin
      .from("outcome_status")
      .insert({ learner_id: fam.learner.id, outcome_code: "8PR2", status: "learning", mastery: 0.5 });
    if (s.error) throw new Error(s.error.message);
  });

  test.afterAll(async () => {
    if (fam && unsure) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id, unsure.parent.id, unsure.learner.id]);
  });

  test("learner completes all 9 slides and the exit ticket; status and mastery update", async ({ page }) => {
    await loginLearner(page, fam.learner.username);
    await page.getByRole("link", { name: "Start today's lesson" }).click();
    await expect(page).toHaveURL(/\/learner\/lesson$/);
    // Confidence 0.7: no diagnostic questions.
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(page.getByTestId("diagnostic")).toHaveCount(0);

    const next = page.getByRole("button", { name: "Next", exact: true });

    // Slide 1: Next is locked until the check-in is done; a wrong answer brings a hint.
    await expectSlide(page, 1, "Warm-up");
    await expect(page.getByTestId("narration-text")).toContainText("Welcome back");
    await expect(next).toBeDisabled();
    await answer(page, "s1a", "4");
    await expect(page.getByTestId("check-s1a")).toContainText("Not yet. Try again.");
    await expect(page.getByTestId("check-s1a")).toContainText("Hint 1");
    await answer(page, "s1a", "5");
    await expect(page.getByTestId("check-s1a")).toContainText("Yes! x = 5");
    await answer(page, "s1b", "x = 5");
    await next.click();

    // Slide 2: balance check-in (tap). Wrong first, then right.
    await expectSlide(page, 2, "The equals sign means balanced");
    await page.getByRole("button", { name: "Nothing changes." }).click();
    await expect(page.getByTestId("check-s2")).toContainText("Not quite");
    await page.getByRole("button", { name: "The scale tips. It is not balanced any more." }).click();
    await next.click();

    // Slide 3: worked example, no check-in.
    await expectSlide(page, 3, "Worked example: skate rental");
    await expect(page.getByTestId("lesson-player")).toContainText("$4");
    await next.click();

    await expectSlide(page, 4, "Your turn to finish it");
    await answer(page, "s4", "5");
    await next.click();

    await expectSlide(page, 5, "Algebra tiles");
    await answer(page, "s5", "6");
    await next.click();

    await expectSlide(page, 6, "Who's right?");
    await page.getByRole("button", { name: "Maya. The 2 multiplies the x and the 3." }).click();
    await next.click();

    await expectSlide(page, 7, "Watch the signs");
    await answer(page, "s7", "-10");
    await next.click();

    await expectSlide(page, 8, "Practice");
    await answer(page, "s8a", "−4");
    await answer(page, "s8b", "6");
    // Use every hint, then reveal the answer: still allowed to go on.
    for (let i = 0; i < 3; i++) await page.getByTestId("check-s8c").getByRole("button", { name: "Get a hint" }).click();
    await answer(page, "s8c", "7");
    await page.getByTestId("check-s8c").getByRole("button", { name: "Show me the answer" }).click();
    await expect(page.getByTestId("check-s8c")).toContainText("The answer is 5.");
    // Medium pace (default learning rate 0.2): a 4th practice item (§7.8 pace table).
    await expect(page.getByTestId("check-s8e")).toHaveCount(0);
    await answer(page, "s8d", "5");
    await next.click();

    await expectSlide(page, 9, "Show what you know");
    await page.getByRole("button", { name: "Go to the last questions" }).click();

    // Exit ticket: the answer key is not sent to the browser.
    const exit = page.getByTestId("exit-ticket");
    await expect(exit).toBeVisible();
    expect(await page.content()).not.toContain("mastery_threshold");
    await exit.getByRole("button", { name: "Finish lesson" }).click();
    await expect(exit.getByRole("alert")).toContainText("answer all four");

    await page.getByTestId("exit-e1").getByLabel("x = 5", { exact: true }).check();
    await page.getByTestId("exit-e2").getByLabel("x = 3", { exact: true }).check();
    await page.getByTestId("exit-e3").getByLabel("Take away 5 from the right side too, to keep it balanced.").check();
    await exit.getByLabel(/most important rule/).fill("Do the same thing to both sides so it stays balanced.");
    await exit.getByRole("button", { name: "Finish lesson" }).click();

    const results = page.getByTestId("lesson-results");
    // Saving waits for check-in answers still going to the learner model.
    await expect(results).toContainText("You got 3 out of 3.", { timeout: 30_000 });
    await expect(results).toContainText("You have got this goal");
    await expect(page.getByTestId("result-status")).toHaveText("Got it!");

    // Database: outcome_status, learner_profiles.mastery and assessments were written.
    const admin = adminClient();
    const status = await admin
      .from("outcome_status")
      .select("status, mastery, achieved_at")
      .eq("learner_id", fam.learner.id)
      .eq("outcome_code", "8PR2")
      .single();
    expect(status.data).toMatchObject({ status: "achieved", mastery: 1 });
    expect(status.data?.achieved_at).toBeTruthy();

    // Learner model (§7.8): every first answer (check-ins and exit ticket) went through BKT,
    // starting from the profile's estimate. A hint before answering counts as "not yet".
    const firstTries: Record<string, { pInit: number; answers: boolean[] }> = {
      "8PR2.one_step": { pInit: 0.85, answers: [false, true] }, // s1a (4), s1b
      "8PR2.two_step": { pInit: 0.45, answers: [false, true, true, true, true, true, true] }, // s2 wrong, s4, s8a, s8b, s8d, e1, e3
      "8PR2.distributive": { pInit: 0.2, answers: [true, true, false, true] }, // s5, s6, s8c (hints first), e2
      "8N7.integers": { pInit: 0.7, answers: [true] }, // s7
    };
    await expect
      .poll(async () => (await admin.from("knowledge_state").select("skill_id").eq("learner_id", fam.learner.id)).data?.length)
      .toBe(4);
    const ks = await admin.from("knowledge_state").select("skill_id, attempts, p_mastery, p_init").eq("learner_id", fam.learner.id);
    const prof = await admin.from("learner_profiles").select("mastery, misconceptions, readiness, learning_rate").eq("learner_id", fam.learner.id).single();
    for (const [skill, { pInit, answers }] of Object.entries(firstTries)) {
      const row = ks.data?.find((r) => r.skill_id === skill);
      expect(row?.attempts, skill).toBe(answers.length);
      expect(Number(row?.p_init), skill).toBe(pInit);
      const expected = Math.round(replay(pInit, answers, DEFAULT_PARAMS) * 100) / 100;
      expect(prof.data?.mastery[skill], skill).toBe(expected);
    }
    expect(prof.data?.misconceptions).toEqual([]);
    // readiness = mean mastery of 8PR2's prerequisites (one-step and integers).
    const m = prof.data?.mastery as Record<string, number>;
    expect(Number(prof.data?.readiness)).toBeCloseTo((m["8PR2.one_step"] + m["8N7.integers"]) / 2, 2);
    expect(prof.data?.learning_rate).toMatchObject({ level: "medium", p_transit: 0.2 });

    const assessments = await admin.from("assessments").select("kind, score, lesson_id, item_results").eq("learner_id", fam.learner.id);
    expect(assessments.data).toHaveLength(1);
    expect(assessments.data?.[0]).toMatchObject({ kind: "exit", score: 1, lesson_id: "8PR2-demo-A" });

    // The goals board shows the new status.
    await results.getByRole("link", { name: "Back to my goals" }).click();
    await expect(page.getByTestId("outcome-8PR2")).toContainText("Got it!");
  });

  test("a learner with an unsure profile (< 0.6) gets diagnostic questions first", async ({ page }) => {
    await loginLearner(page, unsure.learner.username);
    await page.goto("/learner/lesson");
    await page.getByRole("button", { name: "Start lesson" }).click();
    const diag = page.getByTestId("diagnostic");
    await expect(diag).toBeVisible();
    for (const [id, value] of [["d1", "4"], ["d2", "4"], ["d3", "3"], ["d4", "10"]] as const) {
      await answer(page, id, value);
      await diag.getByRole("button", { name: id === "d4" ? "Start the lesson" : "Next question" }).click();
    }
    await expectSlide(page, 1, "Warm-up");
  });
});

async function expectSlide(page: Page, n: number, title: string) {
  await expect(page.getByTestId("slide-progress")).toHaveText(`Slide ${n} of 9`);
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

async function answer(page: Page, id: string, value: string) {
  const form = page.getByTestId(`check-${id}`);
  await form.getByRole("textbox").fill(value);
  await form.getByRole("button", { name: "Check" }).click();
}
