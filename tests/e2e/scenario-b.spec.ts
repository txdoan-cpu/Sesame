import { expect, test } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { QUICK_SPEECH, answerExitAllRight, loginLearner, loginParent, walkSlides } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Demo scenario B (proposal): a parent sets a 50 CAD reward for 8PR1 + 8PR2 (min 85%,
// re-check after 7 days). When the learner achieves 8PR2, both sides see "halfway there".
// Once both outcomes are achieved and the 7-day re-check passes, the parent is notified
// with a suggested specific praise ("you fixed the distributive mistake yourself").
// Time passing is simulated by moving dates back in the database.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

test.describe("demo scenario B: a parent sets a 50 CAD reward", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "scb");
    // demo-A: M2 and M3 at the start, 8PR2 still "learning".
    const seed = await Promise.all([
      admin.from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), fam.learner.id)),
      admin.from("outcome_status").insert({ learner_id: fam.learner.id, outcome_code: "8PR2", status: "learning", mastery: 0.5 }),
    ]);
    for (const r of seed) if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("goal → halfway milestone → re-check a week later → unlock with praise → given", async ({ browser }) => {
    const admin = adminClient();

    // 1. The parent sets the goal; the child accepts it (co-set).
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto(`/parent/child/${fam.learner.id}/rewards`);
    const form = parent.getByTestId("reward-form");
    await form.getByRole("checkbox", { name: "8PR1" }).check();
    await form.getByLabel("Minimum score (%)").fill("85");
    await form.getByLabel("Deadline").fill(new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10));
    await form.getByLabel("Reward", { exact: true }).fill("Gift of the learner's choice");
    await form.getByLabel("Value in CAD (optional)").fill("50");
    await form.getByRole("button", { name: "Create goal" }).click();
    await expect(form).toContainText("Goal created");

    const child = await browser.newPage();
    await child.addInitScript(QUICK_SPEECH);
    await loginLearner(child, fam.learner.username);
    await child.getByTestId("my-reward").getByRole("button", { name: "I accept this goal" }).click();
    await expect(child.getByTestId("my-reward")).toContainText("You accepted this goal");

    // 2. The child finishes the 8PR2 lesson with full marks → "halfway there" for both.
    await child.goto("/learner/lesson");
    await child.getByRole("button", { name: "Start lesson" }).click();
    await walkSlides(child, 9);
    await child.getByRole("button", { name: "Go to the last questions" }).click();
    await answerExitAllRight(child);

    await child.goto("/learner");
    await expect(child.getByTestId("news-milestone")).toContainText("Halfway there! You reached 8PR2");
    await parent.goto("/parent/notifications");
    await expect(parent.getByTestId("notification-milestone")).toContainText(`Halfway there! ${fam.learner.name} reached 8PR2`);
    // No unlock yet: 8PR1 is not reached and nothing was re-checked.
    let rule = (await admin.from("reward_rules").select("id, status").eq("learner_id", fam.learner.id).single()).data!;
    expect(rule.status).toBe("active");

    // 3. Time passes: 8PR2 was achieved 8 days ago; 8PR1 was reached and re-checked earlier.
    await admin.from("assessments").update({ taken_at: ago(8) }).eq("learner_id", fam.learner.id).eq("outcome_code", "8PR2");
    await admin.from("outcome_status").update({ achieved_at: ago(8) }).eq("learner_id", fam.learner.id).eq("outcome_code", "8PR2");
    await admin.from("outcome_status").insert({ learner_id: fam.learner.id, outcome_code: "8PR1", status: "achieved", mastery: 0.9, achieved_at: ago(20) });
    await admin.from("assessments").insert([
      { learner_id: fam.learner.id, outcome_code: "8PR1", kind: "exit", score: 0.9, item_results: { mastered: true }, taken_at: ago(20) },
      { learner_id: fam.learner.id, outcome_code: "8PR1", kind: "retention", score: 0.9, item_results: { mastered: true }, taken_at: ago(10) },
    ]);

    // The memory check for 8PR2 is now ready; the child takes it.
    await child.reload();
    const news = child.getByTestId("learner-news");
    await expect(news).toContainText("Memory check ready for 8PR2");
    await news.getByRole("link", { name: "Start memory check" }).click();
    await expect(child.getByRole("heading", { level: 1, name: "Memory check" })).toBeVisible();
    await answerExitAllRight(child);

    // 4. Unlocked: the parent gets the suggested specific praise.
    rule = (await admin.from("reward_rules").select("id, status").eq("learner_id", fam.learner.id).single()).data!;
    expect(rule.status).toBe("unlocked");
    await parent.goto("/parent/notifications");
    const unlocked = parent.getByTestId("notification-reward_unlocked");
    await expect(unlocked).toContainText(`${fam.learner.name} unlocked the reward "Gift of the learner's choice"`);
    await expect(unlocked).toContainText("You fixed the distributive mistake yourself");

    await child.goto("/learner");
    await expect(child.getByTestId("news-reward_unlocked")).toContainText("You unlocked your reward");

    // The parent gives the reward and marks it.
    await parent.goto(`/parent/child/${fam.learner.id}/rewards`);
    const card = parent.getByTestId("reward-rule").first();
    await expect(card).toContainText("Unlocked!");
    await card.getByRole("button", { name: "Mark as given" }).click();
    await expect(parent.getByTestId("reward-rule").first()).toContainText("Given");

    // Milestones were announced once each, never twice.
    const milestones = await admin.from("notifications").select("payload").eq("recipient_id", fam.parent.id).eq("type", "milestone");
    const announced = (milestones.data ?? []).flatMap((m) => (m.payload as { outcomes: string[] }).outcomes);
    expect(announced.sort()).toEqual(["8PR1", "8PR2"]);
  });
});
