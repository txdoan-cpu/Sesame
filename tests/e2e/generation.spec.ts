import { expect, test } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { loginLearner, loginStaff } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, learnerEmailFor, randomTag, signedIn, supabaseConfigured, TEST_PASSWORD, type TestFamily } from "./helpers/supabase";

// Round 10 "done when": for a new LO with approved materials, the system generates
// a lesson scoring >= 75 with a rationale card and citations; failing lessons reach
// the review queue. Uses the mock author and critic (LLM_PROVIDER=mock); a material
// containing "MATHBUG" makes the author write one wrong answer.

test.describe("lesson generation (Round 10)", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  const tag = randomTag();
  const good = `G${tag}A`.toUpperCase();
  const buggy = `G${tag}B`.toUpperCase();
  const teacherEmail = `e2e-gen-teacher-${tag}@example.com`;
  let teacherId = "";
  let packId = "";
  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    const t = await admin.auth.admin.createUser({ email: teacherEmail, password: TEST_PASSWORD, email_confirm: true, app_metadata: { role: "teacher" }, user_metadata: { display_name: `Gen Teacher ${tag}` } });
    if (t.error || !t.data.user) throw new Error(t.error?.message);
    teacherId = t.data.user.id;

    const pack = await admin.from("curricula").insert({ province: "NL", grade: 9, subject: "Mathematics", source_title: `E2E gen pack ${tag}`, created_by: teacherId }).select("id").single();
    if (pack.error) throw new Error(pack.error.message);
    packId = pack.data.id as string;
    for (const code of [good, buggy]) {
      const o = await admin.from("outcomes").insert({ code, strand: "PR", curriculum_id: packId, description_en: "Model and solve linear equations with rational coefficients", bloom_level: "apply", knowledge_type: "procedural", prerequisites: ["8PR2"], created_by: teacherId });
      if (o.error) throw new Error(o.error.message);
      await admin.from("indicators").insert([
        { outcome_code: code, code: `${code}.1`, description: "Solve by inverse operations, keeping the equation balanced" },
        { outcome_code: code, code: `${code}.2`, description: "Verify a solution by substitution" },
      ]);
      await admin.from("misconceptions").insert([
        { outcome_code: code, code: "M1", description: "Operates on one side of the equation only" },
        { outcome_code: code, code: "M2", description: "Distributes wrongly: a(x + b) = ax + b" },
      ]);
    }
    const material = (code: string, title: string, text: string) => ({
      curriculum_id: packId,
      outcome_codes: [code],
      title,
      source_url: "https://www.gov.nl.ca/education/",
      licence: "public_document",
      extracted_text: text,
      status: "approved",
      score: 2.8,
      uploaded_by: teacherId,
    });
    const m = await admin.from("materials").insert([
      material(good, `Balance method notes ${tag}`, "Solve equations by doing the same thing to both sides. Example: 3x + 4 = 19, so 3x = 15 and x = 5."),
      material(good, `Worked examples sheet ${tag}`, "Two-step equations: undo adding first, then multiplying. Check by substitution."),
      material(buggy, `Practice sheet ${tag}`, "Practice set with an answer key. MATHBUG"),
    ]);
    if (m.error) throw new Error(m.error.message);

    // A real learner whose goal is the new LO (synthetic test family).
    fam = await createFamily(admin, "gen");
    const profile = LearnerProfileSchema.parse(demoA);
    const lp = await admin.from("learner_profiles").insert({ ...toLearnerProfileRow(profile, fam.learner.id), target_outcome: good });
    if (lp.error) throw new Error(lp.error.message);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    if (packId) {
      await admin.from("lessons").delete().in("outcome_code", [good, buggy]);
      await admin.from("learner_profiles").update({ target_outcome: "8PR2" }).eq("learner_id", fam?.learner.id ?? "");
      await admin.from("indicators").delete().in("outcome_code", [good, buggy]);
      await admin.from("misconceptions").delete().in("outcome_code", [good, buggy]);
      await admin.from("curricula").delete().eq("id", packId);
    }
    await deleteUsers(admin, [teacherId, fam?.parent.id, fam?.learner.id].filter((x): x is string => Boolean(x)));
  });

  test("a teacher generates a lesson for a new LO: delivered >= 75, with rationale card and citations", async ({ page }) => {
    test.setTimeout(120_000);
    await loginStaff(page, teacherEmail, /\/teacher$/);
    await page.goto(`/teacher/pack/${packId}`);
    const gen = page.getByTestId(`generate-${good}`);
    await gen.locator("summary").click();
    await gen.getByRole("combobox").selectOption("demo-A");
    await gen.getByRole("button", { name: "Generate lesson" }).click();

    await expect(page).toHaveURL(/\/teacher\/lesson\/gen-[a-z0-9-]+$/, { timeout: 60_000 });
    await expect(page.getByTestId("lesson-status")).toHaveText("Delivered");
    const score = Number((await page.getByTestId("fit-score").innerText()).split("/")[0]);
    expect(score).toBeGreaterThanOrEqual(75);

    // Rationale card: rules, a method per activity with scores, evidence citations, sources.
    const card = page.getByTestId("rationale-card");
    await expect(card).toContainText("D1"); // demo-A readiness 0.5 < 0.6
    await expect(card).toContainText("D3"); // demo-A has M2, one of this LO's misconceptions
    for (const a of ["activate", "present", "guided_practice", "apply", "close"]) await expect(page.getByTestId(`plan-${a}`)).toBeVisible();
    await expect(page.getByTestId("plan-present")).toContainText("Worked examples");
    await expect(page.getByTestId("plan-guided_practice")).toContainText("Faded examples");
    await page.getByTestId("plan-present").locator("details summary").first().click();
    // Present = concrete first (D4), then worked examples (D1): two methods, each with its evidence.
    await expect(page.getByTestId("plan-present")).toContainText("Concrete, then pictorial, then symbolic");
    await expect(page.getByTestId("plan-present").getByTestId("citations").first()).toContainText("Fyfe");
    await expect(page.getByTestId("sources")).toContainText(`Balance method notes ${tag}`);
    await expect(page.getByTestId("sources")).toContainText("Public government document");

    // Rubric S table with all 15 criteria; the gates pass.
    await expect(page.getByTestId("rubric-s-table").locator("tbody tr")).toHaveCount(15);
    await expect(page.getByTestId("rubric-S10")).toContainText("3 / 3");
    await expect(page.getByTestId("rubric-S1")).not.toContainText("1 / 3");
    // A sample profile, never a learner name.
    await expect(page.getByText("Sample demo-A")).toBeVisible();
    await expect(page.getByTestId("slide-preview").locator("li").first()).toContainText("Activate");
  });

  test("a lesson with a math error is blocked and reaches the teacher review queue", async ({ page }) => {
    test.setTimeout(120_000);
    await loginStaff(page, teacherEmail, /\/teacher$/);
    await page.goto(`/teacher/pack/${packId}`);
    const gen = page.getByTestId(`generate-${buggy}`);
    await gen.locator("summary").click();
    await gen.getByRole("button", { name: "Generate lesson" }).click();
    await expect(page).toHaveURL(/\/teacher\/lesson\/gen-[a-z0-9-]+$/, { timeout: 60_000 });
    await expect(page.getByTestId("lesson-status")).toHaveText("Needs review");
    await expect(page.getByTestId("rubric-S10")).toContainText("0 / 3");
    await expect(page.getByText("Failed gates: S10")).toBeVisible();
    // Regenerated twice (3 attempts) before going to review.
    await page.getByText("Attempts", { exact: true }).click();
    await expect(page.getByTestId("attempts").locator("li")).toHaveCount(3);

    // The queue lists it; a math error can never be approved.
    await page.goto("/teacher/lessons");
    await expect(page.getByTestId("generated-list")).toContainText(buggy);
    await page.getByTestId("generated-list").locator("li", { hasText: buggy }).getByRole("link", { name: "Open" }).click();
    const form = page.getByTestId("review-form");
    await form.getByLabel("Decision").selectOption("approve");
    await form.getByRole("button", { name: "Save review" }).click();
    await expect(form.getByRole("alert")).toContainText("cannot be approved");

    await form.getByLabel("Decision").selectOption("reject");
    await form.getByLabel(/Notes/).fill("The practice answer key is wrong; replace this material.");
    await form.getByRole("button", { name: "Save review" }).click();
    await expect(form.getByText("Rejected.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("lesson-status")).toHaveText("Rejected");
    await expect(page.getByTestId("review-history")).toContainText("reject: The practice answer key is wrong");
  });

  test("a real learner gets a generated lesson automatically; teachers see only a pseudonym", async ({ page }) => {
    test.setTimeout(150_000);
    const admin = adminClient();
    await loginLearner(page, fam.learner.username);
    await page.goto("/learner/lesson");
    // No standard lesson for this LO: the new one is being made in the background.
    await expect(page.getByTestId("no-lesson")).toContainText("being made just for you");

    await expect
      .poll(async () => (await admin.from("lessons").select("status").eq("learner_id", fam.learner.id).eq("outcome_code", good).maybeSingle()).data?.status, { timeout: 60_000 })
      .toBe("delivered");

    await page.goto("/learner");
    await page.getByRole("link", { name: "Start today's lesson" }).click();
    await expect(page.getByTestId("lesson-generated")).toBeVisible();
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(page.getByTestId("slide-progress")).toContainText("Slide 1 of");

    // Teachers: the pseudonymised view has no learner id; the base table is closed to them.
    const teacher = await signedIn(teacherEmail);
    const view = await teacher.from("teacher_lessons_v").select("*").eq("outcome_code", good).like("pseudonym", "L-%");
    expect(view.data?.length).toBe(1);
    expect(Object.keys(view.data![0])).not.toContain("learner_id");
    expect(JSON.stringify(view.data)).not.toContain(fam.learner.id);
    expect(JSON.stringify(view.data)).not.toContain(fam.learner.name);
    expect((await teacher.from("lessons").select("id")).data ?? []).toEqual([]);

    // The learner reads their own delivered lesson; the parent reads none.
    const learner = await signedIn(learnerEmailFor(fam));
    expect(((await learner.from("lessons").select("id").eq("outcome_code", good)).data ?? []).length).toBe(1);
    const parent = await signedIn(fam.parent.email);
    expect((await parent.from("lessons").select("id")).data ?? []).toEqual([]);
    expect((await parent.from("teacher_lessons_v").select("id")).data ?? []).toEqual([]);
  });
});
