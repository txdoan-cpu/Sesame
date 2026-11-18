import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import {
  adminClient,
  anonClient,
  createFamily,
  deleteUsers,
  learnerEmailFor,
  signedIn,
  supabaseConfigured,
  TEST_PASSWORD,
  type TestFamily,
} from "./helpers/supabase";

// Round 2 "done when": the outcome board renders grouped by strand.

const STRANDS = [
  { name: "Number", vi: "Số", count: 7 },
  { name: "Patterns and Relations", vi: "Quy luật và quan hệ", count: 2 },
  { name: "Shape and Space", vi: "Hình học và không gian", count: 6 },
  { name: "Statistics and Probability", vi: "Thống kê và xác suất", count: 2 },
];

test.describe("curriculum", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;
  let other: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "cur");
    other = await createFamily(admin, "cur2");
    const profile = LearnerProfileSchema.parse(demoA);
    for (const f of [fam, other]) {
      const r = await admin.from("learner_profiles").insert(toLearnerProfileRow(profile, f.learner.id));
      if (r.error) throw new Error(r.error.message);
    }
    const s = await admin.from("outcome_status").insert([
      { learner_id: fam.learner.id, outcome_code: "8PR2", status: "learning", mastery: 0.5 },
      { learner_id: fam.learner.id, outcome_code: "8N7", status: "nearly", mastery: 0.7 },
    ]);
    if (s.error) throw new Error(s.error.message);
  });

  test.afterAll(async () => {
    if (fam && other) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id, other.parent.id, other.learner.id]);
  });

  test("seed data: 17 outcomes in 4 strands, 8PR2 indicators and misconceptions", async () => {
    const db = await signedIn(fam.parent.email);
    const outcomes = await db.from("outcomes").select("code, strand, description_vi, parent_friendly").order("sort_order");
    expect(outcomes.error).toBeNull();
    expect(outcomes.data).toHaveLength(17);
    for (const o of outcomes.data ?? []) {
      expect(o.description_vi.length, o.code).toBeGreaterThan(10);
      expect(o.parent_friendly.length, o.code).toBeGreaterThan(10);
    }
    const counts = Object.fromEntries(
      ["N", "PR", "SS", "SP"].map((s) => [s, (outcomes.data ?? []).filter((o) => o.strand === s).length]),
    );
    expect(counts).toEqual({ N: 7, PR: 2, SS: 6, SP: 2 });

    const ind = await db.from("indicators").select("code").eq("outcome_code", "8PR2").order("code");
    expect(ind.data?.map((r) => r.code)).toEqual(["PR2.1", "PR2.2", "PR2.3", "PR2.4", "PR2.5", "PR2.6"]);

    const mis = await db.from("misconceptions").select("code").eq("outcome_code", "8PR2").order("code");
    expect(mis.data?.map((r) => r.code)).toEqual(["M1", "M2", "M3", "M4", "M5"]);
  });

  test("signed-out visitors cannot read curriculum or profiles", async () => {
    const db = anonClient();
    for (const table of ["outcomes", "strands", "indicators", "misconceptions", "learner_profiles", "outcome_status"]) {
      const res = await db.from(table).select("*");
      expect(res.data ?? [], table).toEqual([]);
    }
  });

  test("learner profile and status: learner sees own only; parent never reads base tables", async () => {
    const learner = await signedIn(learnerEmailFor(fam));
    const prof = await learner.from("learner_profiles").select("learner_id, misconceptions, interests");
    expect(prof.data).toEqual([{ learner_id: fam.learner.id, misconceptions: ["M2", "M3"], interests: ["hockey", "video games"] }]);
    const status = await learner.from("outcome_status").select("learner_id");
    expect(new Set(status.data?.map((r) => r.learner_id))).toEqual(new Set([fam.learner.id]));

    const parent = await signedIn(fam.parent.email);
    expect((await parent.from("learner_profiles").select("learner_id")).data).toEqual([]);
    expect((await parent.from("outcome_status").select("learner_id")).data).toEqual([]);

    // Writes from the client are refused.
    const write = await learner.from("outcome_status").upsert({ learner_id: fam.learner.id, outcome_code: "8SS1", status: "achieved" });
    expect(write.error).not.toBeNull();
  });

  test("learner home shows the outcome board grouped by strand, with status and next lesson", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("learner-login");
    await form.getByLabel("Username").fill(fam.learner.username);
    await form.getByLabel("Password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/learner$/);

    await expectBoard(page, STRANDS.map((s) => s.name));
    const pr2 = page.getByTestId("outcome-8PR2");
    await expect(pr2).toContainText("Next lesson");
    await expect(pr2).toContainText("Learning");
    await expect(page.getByTestId("outcome-8N7")).toContainText("Nearly there");
    await expect(page.getByTestId("outcome-8SS1")).toContainText("Not started");
  });

  test("parent outcomes page renders by strand in English and Vietnamese", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("parent-login");
    await form.getByLabel("Email").fill(fam.parent.email);
    await form.getByLabel("Password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/parent$/);

    await page.getByRole("link", { name: "See the Grade 8 math outcomes" }).click();
    await expect(page).toHaveURL(/\/parent\/outcomes$/);
    await expectBoard(page, STRANDS.map((s) => s.name));
    // No child status on the parent board until sharing views exist (Round 5).
    await expect(page.getByText("Not started")).toHaveCount(0);

    await page.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mục tiêu Toán lớp 8" })).toBeVisible();
    await expectBoard(page, STRANDS.map((s) => s.vi));
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Grade 8 math outcomes" })).toBeVisible();
  });
});

async function expectBoard(page: Page, strandNames: string[]) {
  const board = page.getByTestId("outcome-board");
  await expect(board.getByRole("heading", { level: 3 })).toHaveText(strandNames);
  await expect(board.getByRole("listitem")).toHaveCount(17);
  for (const [i, s] of STRANDS.entries()) {
    const section = board.getByRole("region", { name: strandNames[i] });
    await expect(section.getByRole("listitem")).toHaveCount(s.count);
  }
}
