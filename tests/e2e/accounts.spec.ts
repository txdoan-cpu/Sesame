import { expect, test, type Page } from "@playwright/test";
import {
  adminClient,
  createFamily,
  deleteUsers,
  randomTag,
  supabaseConfigured,
  TEST_PASSWORD,
  type TestFamily,
} from "./helpers/supabase";

// Round 1 "done when": learner sees only own data; parent sees only linked child.
// Full UI flow against the real Supabase project with synthetic accounts.

test.describe("accounts", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  const tag = randomTag();
  const parentA = { name: `Lan ${tag}`, email: `e2e-ui-parent-${tag}@example.com` };
  const childA = { name: `Minh${tag}`, username: `e2e_ui_${tag}` };
  let familyB: TestFamily | undefined;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Account flow runs once; phone layout is checked below");
    familyB = await createFamily(adminClient(), "uib");
  });

  test.afterAll(async () => {
    const admin = adminClient();
    const ids: string[] = [];
    if (familyB) ids.push(familyB.parent.id, familyB.learner.id);
    const child = await admin.from("profiles").select("id").eq("username", childA.username).maybeSingle();
    if (child.data) {
      ids.push(child.data.id);
      const link = await admin.from("family_links").select("parent_id").eq("learner_id", child.data.id);
      ids.push(...(link.data ?? []).map((r) => r.parent_id as string));
    }
    await deleteUsers(admin, ids);
  });

  test("parent signs up and creates a learner account", async ({ page }) => {
    await page.goto("/signup");
    const form = page.getByTestId("parent-signup");
    await form.getByLabel("Your name").fill(parentA.name);
    await form.getByLabel("Email").fill(parentA.email);
    await form.getByLabel("Password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/parent$/);
    await expect(page.getByRole("heading", { level: 1, name: "Parent dashboard" })).toBeVisible();
    await expect(page.getByText("No learner accounts yet")).toBeVisible();

    const add = page.getByTestId("add-child");
    await add.getByLabel("Child's first name").fill(childA.name);
    await add.getByLabel("Username").fill(childA.username);
    await add.getByLabel("Password for your child").fill(TEST_PASSWORD);
    await add.getByRole("button", { name: "Create learner account" }).click();

    await expect(page.getByText("Learner account created.")).toBeVisible();
    const list = page.getByTestId("children-list");
    await expect(list.getByText(childA.name, { exact: true })).toBeVisible();
    await expect(list.getByText(childA.username)).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // Same username again is refused.
    await add.getByLabel("Child's first name").fill("Copy");
    await add.getByLabel("Username").fill(childA.username);
    await add.getByLabel("Password for your child").fill(TEST_PASSWORD);
    await add.getByRole("button", { name: "Create learner account" }).click();
    await expect(add.getByRole("alert")).toContainText("username is taken");
  });

  test("parent can switch the dashboard to Vietnamese", async ({ page }) => {
    await loginParent(page, parentA.email);
    await page.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Trang phụ huynh" })).toBeVisible();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Parent dashboard" })).toBeVisible();
  });

  test("learner logs in with username and sees only their own home", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("learner-login");
    await form.getByLabel("Username").fill(childA.username.toUpperCase());
    await form.getByLabel("Password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/learner$/);
    await expect(page.getByRole("heading", { level: 1, name: `Hi, ${childA.name}!` })).toBeVisible();

    // A learner cannot open the parent area.
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/learner$/);
    await expect(page.getByText(parentA.name)).toHaveCount(0);
  });

  test("another parent sees only their own linked child", async ({ page }) => {
    await loginParent(page, familyB!.parent.email);
    const list = page.getByTestId("children-list");
    await expect(list.getByText(familyB!.learner.name, { exact: true })).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText(childA.name)).toHaveCount(0);

    // A parent cannot open the learner area.
    await page.goto("/learner");
    await expect(page).toHaveURL(/\/parent$/);
  });

  test("wrong password shows a friendly error; signed-out users go to login", async ({ page }) => {
    await page.goto("/login");
    const form = page.getByTestId("learner-login");
    await form.getByLabel("Username").fill(childA.username);
    await form.getByLabel("Password").fill("wrong-password");
    await form.getByRole("button", { name: "Log in" }).click();
    await expect(form.getByRole("alert")).toContainText("not right");

    await page.goto("/parent");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("log out ends the session", async ({ page }) => {
    await loginParent(page, parentA.email);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("login page fits a phone screen with large tap targets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Phone layout check");
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 2, name: "Students" })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()!;
  expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

async function loginParent(page: Page, email: string) {
  await page.goto("/login");
  const form = page.getByTestId("parent-login");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/parent$/);
}
