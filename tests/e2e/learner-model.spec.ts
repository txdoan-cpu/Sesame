import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { loginLearner, walkSlides } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, learnerEmailFor, signedIn, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Round 9 "done when": a simulated learner answering wrong repeatedly is moved
// to "slow" pacing. Everything goes through the real lesson player: first tries
// are scored on the server, update knowledge_state with BKT, and after 20
// answers the learner's own learning rate is re-estimated.

test.describe("learner model (Round 9)", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "bkt");
    // Unsure estimate (< 0.6) → the lesson starts with diagnostic questions.
    const profile = LearnerProfileSchema.parse({ ...demoA, confidence_of_estimate: 0.5 });
    const r = await admin.from("learner_profiles").insert(toLearnerProfileRow(profile, fam.learner.id));
    if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  /** Wrong first try, then wrong again until the answer can be shown. */
  async function numericWrong(page: Page, id: string) {
    const form = page.getByTestId(`check-${id}`);
    const show = form.getByRole("button", { name: "Show me the answer" });
    for (let i = 0; i < 5 && !(await show.isVisible()); i++) {
      await form.getByRole("textbox").fill("999");
      await form.getByRole("button", { name: "Check" }).click();
      await show.waitFor({ state: "visible", timeout: 1_500 }).catch(() => {});
    }
    await show.click();
    await expect(form).toContainText("The answer is");
  }

  async function choiceWrong(page: Page, id: string, wrong: string, right: string) {
    const set = page.getByTestId(`check-${id}`);
    await set.getByRole("button", { name: wrong }).click();
    await set.getByRole("button", { name: right }).click();
  }

  const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true }).click();
  const answers = async () =>
    (await adminClient().from("skill_answers").select("id", { count: "exact", head: true }).eq("learner_id", fam.learner.id)).count ?? 0;
  const rate = async () =>
    (await adminClient().from("learner_profiles").select("learning_rate").eq("learner_id", fam.learner.id).single()).data?.learning_rate as
      | { level?: string; p_transit?: number }
      | undefined;

  test("a learner who answers wrong again and again is moved to slow pacing", async ({ page }) => {
    test.setTimeout(240_000);
    await loginLearner(page, fam.learner.username);
    await page.goto("/learner/lesson");
    // Default learning rate 0.2 → medium.
    await expect(page.getByTestId("lesson-pace")).toHaveAttribute("data-pace", "medium");
    await page.getByRole("button", { name: "Start lesson" }).click();

    // 4 diagnostic questions, all wrong.
    await expect(page.getByTestId("diagnostic")).toBeVisible();
    for (const id of ["d1", "d2", "d3", "d4"]) {
      await numericWrong(page, id);
      await page.getByRole("button", { name: id === "d4" ? "Start the lesson" : "Next question" }).click();
    }

    // Slides 1–8: every first try wrong (11 check-ins at medium pace).
    await numericWrong(page, "s1a");
    await numericWrong(page, "s1b");
    await next(page);
    await choiceWrong(page, "s2", "Nothing changes.", "The scale tips. It is not balanced any more.");
    await next(page);
    await next(page); // slide 3: worked example
    await numericWrong(page, "s4");
    await next(page);
    await numericWrong(page, "s5");
    await next(page);
    await choiceWrong(page, "s6", "Both. They both got an answer.", "Maya. The 2 multiplies the x and the 3.");
    await next(page);
    await numericWrong(page, "s7");
    await next(page);
    for (const id of ["s8a", "s8b", "s8c", "s8d"]) await numericWrong(page, id);
    await next(page);
    await page.getByRole("button", { name: "Go to the last questions" }).click();

    // Exit ticket: all three wrong.
    await page.getByTestId("exit-e1").getByLabel("x = 6.5", { exact: true }).check();
    await page.getByTestId("exit-e2").getByLabel("x = 13", { exact: true }).check();
    await page.getByTestId("exit-e3").getByLabel("Add 5 to the right side.").check();
    await page.getByTestId("exit-ticket").getByRole("textbox").fill("I am not sure.");
    await page.getByTestId("exit-ticket").getByRole("button", { name: "Finish lesson" }).click();
    await expect(page.getByTestId("lesson-results")).toContainText("You got 0 out of 3.");

    // 4 + 11 + 3 = 18 answers: not re-estimated yet, still medium.
    await expect.poll(answers).toBe(18);
    expect((await rate())?.level).toBe("medium");

    // Next try: the estimate is surer now (no diagnostic). Two more wrong answers → 20.
    await page.goto("/learner/lesson");
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(page.getByTestId("diagnostic")).toHaveCount(0);
    await numericWrong(page, "s1a");
    await numericWrong(page, "s1b");
    await expect.poll(answers).toBe(20);

    // Re-estimated after 20 answers: the learner's p_transit is low → slow.
    await expect.poll(async () => (await rate())?.level).toBe("slow");
    expect((await rate())?.p_transit).toBeLessThan(0.15);
    const ks = await adminClient().from("knowledge_state").select("skill_id, p_transit, p_mastery").eq("learner_id", fam.learner.id);
    expect(ks.data?.length).toBeGreaterThan(0);
    for (const row of ks.data ?? []) expect(Number(row.p_transit), row.skill_id).toBeLessThan(0.15);
    const two = ks.data?.find((r) => r.skill_id === "8PR2.two_step");
    expect(Number(two?.p_mastery)).toBeLessThan(0.45); // below the starting estimate

    // The lesson now runs at the slow pace: slower narration, 6 practice items.
    await page.goto("/learner/lesson");
    await expect(page.getByTestId("lesson-pace")).toHaveAttribute("data-pace", "slow");
    await expect(page.getByTestId("lesson-pace")).toContainText("step by step");
    await page.getByRole("button", { name: "Start lesson" }).click();
    await walkSlides(page, 8);
    for (const id of ["s8a", "s8b", "s8c", "s8d", "s8e", "s8f"]) await expect(page.getByTestId(`check-${id}`)).toBeVisible();
    await expect(page.getByTestId("check-s8t")).toHaveCount(0);
  });

  test("the parent cannot read the learner model tables", async () => {
    const parent = await signedIn(fam.parent.email);
    for (const table of ["knowledge_state", "skill_answers"]) {
      const r = await parent.from(table).select("*").eq("learner_id", fam.learner.id);
      expect(r.data ?? [], table).toEqual([]);
    }
    // The learner reads their own model.
    const learner = await signedIn(learnerEmailFor(fam));
    expect(((await learner.from("knowledge_state").select("skill_id")).data ?? []).length).toBeGreaterThan(0);
  });
});
