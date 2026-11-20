import { expect, test } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";
import { loginParent, loginLearner } from "./helpers/lesson";

// Round 5 UI: parent portal and learner sharing controls, end to end.

test.describe("parent portal", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "por");
    const seed = await Promise.all([
      admin.from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), fam.learner.id)),
      admin.from("outcome_status").insert({ learner_id: fam.learner.id, outcome_code: "8PR2", status: "learning", mastery: 0.5 }),
    ]);
    for (const r of seed) if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("parent sets a reward goal; the child accepts it; the parent sees it accepted", async ({ browser }) => {
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.getByRole("link", { name: `Open ${fam.learner.name}'s page` }).click();
    await expect(parent.getByRole("heading", { level: 1, name: fam.learner.name })).toBeVisible();
    await parent.getByRole("link", { name: "Rewards" }).click();

    const form = parent.getByTestId("reward-form");
    await form.getByLabel("Reward", { exact: true }).fill("New hockey stick");
    await form.getByLabel("Value in CAD (optional)").fill("50");
    await form.getByRole("button", { name: "Create goal" }).click();
    await expect(form).toContainText("Goal created");
    const rule = parent.getByTestId("reward-rule").first();
    await expect(rule).toContainText("New hockey stick (50 CAD)");
    await expect(rule.getByTestId("co-set")).toHaveText("Waiting for your child to accept");

    // A goal that is very unlikely to be met by its deadline gets a warning.
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel("Deadline").fill(soon);
    await form.getByLabel("Reward", { exact: true }).fill("Movie night");
    await form.getByRole("button", { name: "Create goal" }).click();
    const movie = parent.getByTestId("reward-rule").filter({ hasText: "Movie night" });
    await expect(movie.getByTestId("feasibility")).toContainText("Very unlikely");

    const child = await browser.newPage();
    await loginLearner(child, fam.learner.username);
    const goal = child.getByTestId("my-reward").filter({ hasText: "New hockey stick" });
    await expect(goal).toContainText("Reach 8PR2 with 80% or more");
    await goal.getByRole("button", { name: "I accept this goal" }).click();
    await expect(goal).toContainText("You accepted this goal");

    await parent.reload();
    await expect(parent.getByTestId("reward-rule").filter({ hasText: "New hockey stick" }).getByTestId("co-set")).toContainText("Accepted by your child");
    await parent.goto("/parent/notifications");
    await expect(parent.getByTestId("notification-reward_accepted")).toContainText("accepted the goal: New hockey stick");
  });

  test("parent adds a study time; the child asks to move it; the parent approves", async ({ browser }) => {
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto(`/parent/child/${fam.learner.id}/schedule`);
    const form = parent.getByTestId("slot-form");
    await form.getByLabel("Day", { exact: true }).selectOption({ label: "Monday" });
    await form.getByLabel("Start time", { exact: true }).fill("16:30");
    await form.getByRole("button", { name: "Add study time" }).click();
    await expect(parent.getByTestId("slot")).toHaveText(/Monday at 16:30, 20 min/);

    const child = await browser.newPage();
    await loginLearner(child, fam.learner.username);
    await expect(child.getByTestId("my-schedule")).toContainText("Monday at 16:30, 20 min");
    await child.getByText("Ask for a different time").click();
    const req = child.getByTestId("request-form");
    await req.getByLabel("Which time?").selectOption({ index: 1 });
    await req.getByLabel("Day", { exact: true }).selectOption({ label: "Tuesday" });
    await req.getByLabel("Start time", { exact: true }).fill("17:00");
    await req.getByLabel("Why? (optional)").fill("Hockey practice on Mondays");
    await req.getByRole("button", { name: "Send request" }).click();
    await expect(req).toContainText("Your parent will decide");

    await parent.reload();
    const request = parent.getByTestId("request").first();
    await expect(request).toContainText("Asks for Tuesday at 17:00");
    await expect(request).toContainText("Hockey practice on Mondays");
    await request.getByRole("button", { name: "Approve" }).click();
    await expect(parent.getByTestId("slot")).toHaveText(/Tuesday at 17:00, 20 min/);
    await expect(parent.getByTestId("request").first()).toContainText("Approved");
  });

  test("the child keeps outcomes private; the parent and 'What my parent sees' both show the placeholder", async ({ browser }) => {
    const child = await browser.newPage();
    await loginLearner(child, fam.learner.username);
    await child.getByRole("link", { name: "What I share" }).click();
    const outcomes = child.getByTestId("sharing-outcome_status");
    await expect(outcomes.getByTestId("sharing-state")).toHaveText("Shared");
    // Locked items have no switch.
    await expect(child.getByTestId("sharing-attendance").getByRole("button")).toHaveCount(0);
    await expect(child.getByTestId("sharing-safety_alerts").getByRole("button")).toHaveCount(0);
    await expect(child.getByTestId("sharing-reward_progress").getByRole("button")).toHaveCount(0);
    await outcomes.getByRole("button", { name: "Keep it private" }).click();
    await expect(outcomes.getByTestId("sharing-state")).toHaveText("Private");

    await child.getByRole("link", { name: "See what my parent sees" }).click();
    await expect(child.getByTestId("private-outcome_status")).toHaveText("Your child is keeping this private.");
    await expect(child.getByTestId("section-reward_progress")).toContainText("New hockey stick");

    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto(`/parent/child/${fam.learner.id}`);
    await expect(parent.getByTestId("private-outcome_status")).toHaveText("Your child is keeping this private.");
    await expect(parent.getByTestId("private-question_summaries")).toBeVisible();
    await expect(parent.getByTestId("private-misconceptions")).toBeVisible();
    await expect(parent.getByTestId("section-scores")).not.toContainText("keeping this private");

    // Vietnamese for the parent.
    await parent.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(parent.getByTestId("private-outcome_status")).toHaveText("Con bạn đang giữ riêng mục này.");
    await parent.getByRole("button", { name: "English" }).click();

    // Share again.
    await child.goto("/learner/sharing");
    await child.getByTestId("sharing-outcome_status").getByRole("button", { name: "Share it" }).click();
    await parent.reload();
    await expect(parent.getByTestId("outcome-8PR2")).toContainText("Learning");

    // Learning pace (Round 9 owner decision): private by default; the child may share it.
    await expect(parent.getByTestId("private-learning_pace")).toBeVisible();
    await child.getByTestId("sharing-learning_pace").getByRole("button", { name: "Share it" }).click();
    await expect(child.getByTestId("sharing-learning_pace").getByTestId("sharing-state")).toHaveText("Shared");
    await parent.reload();
    await expect(parent.getByTestId("learning-pace")).toBeVisible();
    await parent.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(parent.getByTestId("section-learning_pace")).toContainText("Nhịp độ học");
    await parent.getByRole("button", { name: "English" }).click();
    await child.getByTestId("sharing-learning_pace").getByRole("button", { name: "Keep it private" }).click();
  });

  test("parent resets the child's password; the child logs in with the new one", async ({ browser }) => {
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto(`/parent/child/${fam.learner.id}/account`);
    await expect(parent.getByText(`username ${fam.learner.username}`)).toBeVisible();
    const form = parent.getByTestId("reset-form");
    await form.getByLabel("New password").fill("Brand-new-pass-9");
    await form.getByRole("button", { name: "Reset password" }).click();
    await expect(form).toContainText("Password changed.");

    const child = await browser.newPage();
    await child.goto("/login");
    const login = child.getByTestId("learner-login");
    await login.getByLabel("Username").fill(fam.learner.username);
    await login.getByLabel("Password").fill("Brand-new-pass-9");
    await login.getByRole("button", { name: "Log in" }).click();
    await expect(child).toHaveURL(/\/learner$/);
  });

  test("another parent cannot open this child's pages", async ({ browser }) => {
    const other = await createFamily(adminClient(), "por2");
    try {
      const page = await browser.newPage();
      await loginParent(page, other.parent.email);
      await page.goto(`/parent/child/${fam.learner.id}`);
      await expect(page).toHaveURL(/\/parent$/);
      await page.goto(`/parent/child/${fam.learner.id}/account`);
      await expect(page).toHaveURL(/\/parent$/);
    } finally {
      await deleteUsers(adminClient(), [other.parent.id, other.learner.id]);
    }
  });
});

