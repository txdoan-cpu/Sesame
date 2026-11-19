import { expect, test } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { loginLearner, loginParent } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// "Why this lesson" card (proposal: rationale card). Reasons about mistakes and math
// anxiety stay hidden until the child shares misconceptions (§7.3).

test.describe("rationale card", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    fam = await createFamily(adminClient(), "rat");
    const r = await adminClient().from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), fam.learner.id));
    if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("parent sees why; private reasons appear only when the child shares them", async ({ browser }) => {
    const parent = await browser.newPage();
    await loginParent(parent, fam.parent.email);
    await parent.goto(`/parent/child/${fam.learner.id}`);
    const card = parent.getByTestId("rationale");
    await expect(card).toContainText("Why this lesson");
    await expect(card.getByTestId("fit-score")).toHaveText("Pedagogical fit: 92/100");
    await expect(card).toContainText("Likes hockey");
    await expect(card).toContainText("Two-step equations are weak (45%)");
    // Mistakes (M2, M3) and math anxiety are private by default.
    await expect(card).not.toContainText("M2");
    await expect(card).not.toContainText("anxiety");
    await expect(card.getByTestId("rationale-hidden")).toHaveText("3 more reasons are based on things your child keeps private.");

    // Vietnamese.
    await parent.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(parent.getByTestId("rationale")).toContainText("Vì sao chọn bài này");
    await expect(parent.getByTestId("rationale")).toContainText("Thích khúc côn cầu");
    await parent.getByRole("button", { name: "English" }).click();

    // The child shares mistakes → the full card, for the parent and on "What my parent sees".
    const child = await browser.newPage();
    await loginLearner(child, fam.learner.username);
    await child.goto("/learner/sharing");
    await child.getByTestId("sharing-misconceptions").getByRole("button", { name: "Share it" }).click();
    await expect(child.getByTestId("sharing-misconceptions").getByTestId("sharing-state")).toHaveText("Shared");
    await child.goto("/learner/parent-view");
    await expect(child.getByTestId("rationale")).toContainText("mistake M2");

    await parent.reload();
    const full = parent.getByTestId("rationale");
    await expect(full).toContainText("mistake M2");
    await expect(full).toContainText("math anxiety");
    await expect(full.getByTestId("rationale-row")).toHaveCount(7);
    await expect(full.getByTestId("rationale-hidden")).toHaveCount(0);

    // Keeping outcome progress private hides the mastery-based reasons too.
    await child.goto("/learner/sharing");
    await child.getByTestId("sharing-outcome_status").getByRole("button", { name: "Keep it private" }).click();
    await expect(child.getByTestId("sharing-outcome_status").getByTestId("sharing-state")).toHaveText("Private");
    await parent.reload();
    await expect(parent.getByTestId("rationale")).not.toContainText("45%");
    await expect(parent.getByTestId("rationale-hidden")).toHaveText("2 more reasons are based on things your child keeps private.");
  });
});
