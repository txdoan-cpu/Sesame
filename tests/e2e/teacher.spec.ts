import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { loginStaff } from "./helpers/lesson";
import {
  adminClient,
  createFamily,
  deleteUsers,
  learnerEmailFor,
  randomTag,
  signedIn,
  supabaseConfigured,
  TEST_PASSWORD,
  type TestFamily,
} from "./helpers/supabase";

// Round 8 "done when": a teacher adds a new LO with 2 materials and sees Rubric R
// scores; tests prove teachers cannot read learner/parent data. Uses the mock
// reviewer (LLM_PROVIDER=mock): text with "WRONG" fails gate R3.

const PUBLISHED_OUTCOMES = 17;

test.describe("teacher input (Round 8)", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  const tag = randomTag();
  const adminEmail = `e2e-admin-${tag}@example.com`;
  const uiTeacherEmail = `e2e-teacher-ui-${tag}@example.com`;
  const apiTeacherEmail = `e2e-teacher-api-${tag}@example.com`;
  const otherTeacherEmail = `e2e-teacher-other-${tag}@example.com`;
  const codeA = `T${tag}A`.toUpperCase();
  const codeB = `T${tag}B`.toUpperCase();
  const codeApi = `T${tag}X`.toUpperCase();
  const codeOther = `T${tag}O`.toUpperCase();
  const userIds: string[] = [];
  let fam: TestFamily;
  let apiTeacherId = "";
  let packUrl = "";

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    const mk = async (email: string, role: "admin" | "teacher", name: string) => {
      const r = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        app_metadata: { role },
        user_metadata: { display_name: name },
      });
      if (r.error || !r.data.user) throw new Error(`create ${role}: ${r.error?.message}`);
      userIds.push(r.data.user.id);
      return r.data.user.id;
    };
    await mk(adminEmail, "admin", `Admin ${tag}`);
    apiTeacherId = await mk(apiTeacherEmail, "teacher", `Teacher API ${tag}`);
    await mk(otherTeacherEmail, "teacher", `Teacher Other ${tag}`);

    // A family with real-looking (synthetic) data the teachers must not see.
    fam = await createFamily(admin, "tch");
    userIds.push(fam.parent.id, fam.learner.id);
    const profile = LearnerProfileSchema.parse(demoA);
    const lp = await admin.from("learner_profiles").insert(toLearnerProfileRow(profile, fam.learner.id));
    if (lp.error) throw new Error(lp.error.message);
    await admin.from("outcome_status").insert({ learner_id: fam.learner.id, outcome_code: "8PR2", status: "learning", mastery: 0.4 });
    await admin.from("notifications").insert({ recipient_id: fam.parent.id, type: "milestone", payload: { note: "e2e" } });
    await admin.from("reward_rules").insert({
      parent_id: fam.parent.id,
      learner_id: fam.learner.id,
      outcomes: ["8PR2"],
      min_score: 0.8,
      retention_days: 7,
      deadline: "2027-06-30",
      reward_text: "Skates",
      value: 50,
      currency: "CAD",
    });
    await admin.from("schedules").insert({ learner_id: fam.learner.id, weekday: 2, start_time: "16:00", duration_min: 20, active: true });
  });

  test.afterAll(async () => {
    const admin = adminClient();
    const codes = [codeA, codeB, codeApi, codeOther];
    const { data: packs } = await admin.from("curricula").select("id").ilike("source_title", `%${tag}%`);
    const packIds = (packs ?? []).map((p) => p.id as string);
    if (packIds.length) {
      const { data: mats } = await admin.from("materials").select("storage_path").in("curriculum_id", packIds);
      const paths = (mats ?? []).map((m) => m.storage_path as string | null).filter((p): p is string => !!p);
      if (paths.length) await admin.storage.from("materials").remove(paths);
    }
    await admin.from("indicators").delete().in("outcome_code", codes);
    await admin.from("misconceptions").delete().in("outcome_code", codes);
    await admin.from("outcomes").delete().in("code", codes);
    if (packIds.length) await admin.from("curricula").delete().in("id", packIds);
    // The UI-created teacher is found by email.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const ui = list?.users.find((u) => u.email === uiTeacherEmail);
    await deleteUsers(admin, ui ? [...userIds, ui.id] : userIds);
  });

  async function logout(page: Page) {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login|\/$/);
  }

  test("admin creates a teacher; the teacher adds an LO, imports outcomes, uploads 2 materials and sees Rubric R", async ({ page }) => {
    test.setTimeout(180_000);

    // Admin creates the teacher account in the app.
    await loginStaff(page, adminEmail, /\/admin$/);
    const form = page.getByTestId("new-teacher");
    await form.getByLabel("Name").fill(`Ms Teacher ${tag}`);
    await form.getByLabel("Email").fill(uiTeacherEmail);
    await form.getByLabel("Temporary password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Create teacher" }).click();
    await expect(form.getByText("Teacher account created.")).toBeVisible();
    await expect(page.getByTestId("teacher-list")).toContainText(uiTeacherEmail);
    await logout(page);

    // The teacher logs in and creates a curriculum pack.
    await loginStaff(page, uiTeacherEmail, /\/teacher$/);
    const pack = page.getByTestId("new-pack");
    await pack.getByLabel("Grade").fill("9");
    await pack.getByLabel("Official source (title)").fill(`E2E pack ${tag}`);
    await pack.getByRole("button", { name: "Create pack" }).click();
    await expect(page).toHaveURL(/\/teacher\/pack\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("pack-title")).toContainText("Grade 9");
    // Teachers cannot publish; only admins can.
    await expect(page.getByTestId("publish-section")).toContainText("Only an admin can publish");
    await expect(page.getByTestId("publish-form")).toHaveCount(0);

    // A new LO by form.
    const lo = page.getByTestId("add-outcome");
    await lo.getByLabel("Code", { exact: true }).fill(codeA);
    await lo.getByLabel("Strand").selectOption("PR");
    await lo.getByLabel("Description", { exact: true }).fill("Solve linear equations with rational coefficients");
    await lo.getByLabel("Indicators").fill(`${codeA}.1: Solve by inverse operations\n${codeA}.2: Verify by substitution`);
    await lo.getByLabel("Misconceptions").fill("M1: Operates on one side only");
    await lo.getByLabel("Prerequisites").fill("8PR2");
    await lo.getByRole("button", { name: "Add outcome" }).click();
    await expect(lo.getByText("Outcome added as a draft.")).toBeVisible();
    const card = page.getByTestId(`outcome-${codeA}`);
    await expect(card).toContainText("Draft");
    await expect(card).toContainText("Indicators (2)");

    // CSV import: a duplicate code is flagged and blocks saving.
    const header = "code,strand,description,bloom_level,knowledge_type,indicators,misconceptions,prerequisites";
    const imp = page.getByTestId("import-form");
    await imp.getByLabel("Choose a CSV or JSON file").setInputFiles({
      name: "outcomes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`${header}\n${codeB},PR,Graph linear relations from a table,apply,procedural,${codeB}.1: Make a table of values,,\n${codeA},PR,Duplicate,apply,procedural,,,\n`),
    });
    await imp.getByRole("button", { name: "Check the file" }).click();
    await expect(imp.getByTestId("import-ready")).toHaveText("1 of 2 rows are ready.");
    await expect(imp.getByTestId("import-preview")).toContainText(`code ${codeA} already exists`);
    await expect(imp.getByRole("button", { name: /Save/ })).toHaveCount(0);

    await imp.getByLabel("Choose a CSV or JSON file").setInputFiles({
      name: "outcomes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`${header}\n${codeB},PR,Graph linear relations from a table,apply,procedural,${codeB}.1: Make a table of values,,\n`),
    });
    await imp.getByRole("button", { name: "Check the file" }).click();
    await imp.getByRole("button", { name: "Save 1 outcomes" }).click();
    await expect(imp.getByText("1 outcomes saved as drafts.")).toBeVisible();
    await expect(page.getByTestId(`outcome-${codeB}`)).toBeVisible();

    packUrl = page.url();

    // Material 1: accurate text → approved.
    const up = page.getByTestId("material-upload");
    await up.getByLabel("Title").fill(`Balance method notes ${tag}`);
    await up.getByLabel("File (PDF, image or text, up to 10 MB)").setInputFiles({
      name: "balance.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Solve 2x + 3 = 11. Subtract 3 from both sides: 2x = 8. Divide both sides by 2: x = 4. Check: 2(4) + 3 = 11."),
    });
    await up.locator('select[name="licence"]').selectOption("cc_by");
    await up.getByRole("button", { name: "Upload and score" }).click();
    await expect(page).toHaveURL(/\/teacher\/material\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByTestId("material-status")).toHaveText("Approved");
    await expect(page.getByTestId("rubric-table").locator("tbody tr")).toHaveCount(10);
    await expect(page.getByTestId("rubric-R1")).toContainText("3 / 3");
    await expect(page.getByTestId("rubric-mean")).toContainText("/ 3");

    // Material 2: has a wrong worked answer → R3 gate fails → rejected with reasons.
    await page.goto(packUrl);
    await up.getByLabel("Title").fill(`Worksheet with errors ${tag}`);
    await up.getByText(codeB, { exact: true }).click(); // link to both outcomes
    await up.getByLabel("File (PDF, image or text, up to 10 MB)").setInputFiles({
      name: "worksheet.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Practice\n2x + 3 = 11 so x = 5. WRONG on purpose for the test."),
    });
    await up.locator('select[name="licence"]').selectOption("fair_dealing");
    await up.getByLabel("Licence note").fill("Short excerpt used for private study and review.");
    await up.getByRole("button", { name: "Upload and score" }).click();
    await expect(page).toHaveURL(/\/teacher\/material\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByTestId("material-status")).toHaveText("Rejected");
    await expect(page.getByTestId("rubric-R3")).toContainText("1 / 3");
    await expect(page.getByText("Failed gates: R3")).toBeVisible();
    await expect(page.getByTestId("reject-reasons")).toContainText("R3 Accurate");

    // The teacher overrides with a written reason.
    const ov = page.getByTestId("override-form");
    await ov.getByLabel("Decision").selectOption("approved");
    await ov.getByLabel("Reason").fill("I will fix the wrong answer in class; the other items are fine.");
    await ov.getByRole("button", { name: "Save override" }).click();
    await expect(ov.getByText("Override saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("material-status")).toHaveText("Approved");
    await expect(page.getByTestId("override-note")).toContainText("I will fix the wrong answer");

    // Both materials are listed on the pack.
    await page.goto(packUrl);
    await expect(page.getByTestId("material-list").locator("li")).toHaveCount(2);
  });

  test("only an admin publishes a pack; learners see approved outcomes only while it is published", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!packUrl, "needs the pack from the previous test");
    const learner = await signedIn(learnerEmailFor(fam));
    const codesSeen = async () => ((await learner.from("outcomes").select("code")).data ?? []).map((o) => o.code as string);

    await loginStaff(page, adminEmail, /\/admin$/);
    await page.goto(packUrl);
    const section = page.getByTestId("publish-section");

    // Nothing approved yet → refused.
    const form = page.getByTestId("publish-form");
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Publish pack" }).click();
    await expect(form.getByText("Approve at least one outcome before publishing.")).toBeVisible();

    // Approve codeA (codeB stays a draft), then publish; keep the window short (shared database).
    await page.getByTestId(`outcome-${codeA}`).getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId(`outcome-${codeA}`)).toContainText("Approved");
    try {
      await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Publish pack" }).click();
      await expect(form.getByText("Pack published.")).toBeVisible();
      const seen = await codesSeen();
      expect(seen).toContain(codeA);
      expect(seen).not.toContain(codeB);
      expect(seen.length).toBe(PUBLISHED_OUTCOMES + 1);
      await page.reload();
      await expect(page.getByTestId("pack-published")).toHaveText("Published");
    } finally {
      // Unpublish through the UI; fall back to the service role so the live demo never keeps it.
      await page.reload();
      const f2 = page.getByTestId("publish-form");
      const admin = adminClient();
      try {
        await f2.getByRole("checkbox").check();
        await f2.getByRole("button", { name: "Unpublish pack" }).click();
        await expect(f2.getByText("Pack unpublished.")).toBeVisible();
        await page.reload();
        await expect(page.getByTestId("pack-published")).toHaveText("Not published");
      } finally {
        // Safety net: the live demo must never keep these outcomes.
        await admin.from("outcomes").update({ published: false }).in("code", [codeA, codeB]);
        await admin.from("curricula").update({ published: false }).ilike("source_title", `%${tag}%`);
      }
    }
    expect(await codesSeen()).not.toContain(codeA);
    expect((await codesSeen()).length).toBe(PUBLISHED_OUTCOMES);
    await expect(section).toBeVisible();
  });

  test("a teacher cannot read learner or parent data", async () => {
    const db = await signedIn(apiTeacherEmail);

    const profiles = await db.from("profiles").select("id, role");
    expect(profiles.data).toEqual([{ id: apiTeacherId, role: "teacher" }]);

    const tables = [
      "family_links",
      "learner_profiles",
      "sessions",
      "events",
      "questions",
      "assessments",
      "outcome_status",
      "reward_rules",
      "schedules",
      "schedule_change_requests",
      "sharing_settings",
      "notifications",
      "safety_reviews",
      "knowledge_state",
      "skill_answers",
      "parent_children_v",
      "parent_attendance_v",
      "parent_outcome_status_v",
      "parent_scores_v",
      "parent_questions_v",
      "parent_misconceptions_v",
      "parent_reward_progress_v",
      "sharing_v",
    ];
    for (const t of tables) {
      const r = await db.from(t).select("*").limit(5);
      expect(r.data ?? [], `${t} must be empty for a teacher`).toEqual([]);
    }

    // No writes to family data either.
    const w = await db.from("reward_rules").insert({
      parent_id: fam.parent.id,
      learner_id: fam.learner.id,
      outcomes: ["8PR2"],
      min_score: 0.8,
      retention_days: 7,
      deadline: "2027-06-30",
      reward_text: "x",
      value: 1,
      currency: "CAD",
    });
    expect(w.error).not.toBeNull();
    // Materials are written only by the server.
    const m = await db.from("materials").insert({ curriculum_id: "00000000-0000-4000-8000-000000000008", outcome_codes: ["8PR2"], title: "x", source_url: "https://example.org", licence: "cc0" });
    expect(m.error).not.toBeNull();
  });

  test("approved outcomes are read-only for teachers, and drafts belong to their author", async () => {
    const db = await signedIn(apiTeacherEmail);
    const admin = adminClient();

    // Approved (published) 8PR2: no change goes through.
    await db.from("outcomes").update({ description_en: "hacked" }).eq("code", "8PR2");
    const after = await admin.from("outcomes").select("description_en").eq("code", "8PR2").single();
    expect(after.data?.description_en).not.toBe("hacked");
    await db.from("indicators").insert({ outcome_code: "8PR2", code: `X${tag}`, description: "sneaky" });
    const sneaky = await admin.from("indicators").select("code").eq("code", `X${tag}`);
    expect(sneaky.data).toEqual([]);

    // A draft created by the API teacher: forced to draft, unpublished, owned by them.
    const ins = await db.from("outcomes").insert({
      code: codeApi,
      strand: "PR",
      curriculum_id: "00000000-0000-4000-8000-000000000008",
      description_en: "Draft for the RLS test",
      status: "approved",
      published: true,
    });
    expect(ins.error).toBeNull();
    const row = await admin.from("outcomes").select("status, published, created_by").eq("code", codeApi).single();
    expect(row.data).toEqual({ status: "draft", published: false, created_by: apiTeacherId });

    // Another teacher can see it (staff) but cannot change it.
    const other = await signedIn(otherTeacherEmail);
    expect((await other.from("outcomes").select("code").eq("code", codeApi)).data).toEqual([{ code: codeApi }]);
    await other.from("outcomes").update({ description_en: "changed by someone else" }).eq("code", codeApi);
    expect((await admin.from("outcomes").select("description_en").eq("code", codeApi).single()).data?.description_en).toBe("Draft for the RLS test");

    // The author cannot publish it.
    await db.from("outcomes").update({ published: true }).eq("code", codeApi);
    expect((await admin.from("outcomes").select("published").eq("code", codeApi).single()).data?.published).toBe(false);
  });

  test("learners and parents still see only the 17 published outcomes", async () => {
    for (const email of [learnerEmailFor(fam), fam.parent.email]) {
      const db = await signedIn(email);
      const outcomes = await db.from("outcomes").select("code");
      expect(outcomes.data?.length).toBe(PUBLISHED_OUTCOMES);
      const codes = (outcomes.data ?? []).map((o) => o.code as string);
      for (const c of [codeA, codeB, codeApi]) expect(codes).not.toContain(c);
      expect((await db.from("curricula").select("id")).data?.length).toBe(1);
      expect((await db.from("materials").select("id")).data ?? []).toEqual([]);
    }
  });
});
