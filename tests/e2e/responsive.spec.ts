import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { QUICK_SPEECH, loginLearner, loginParent, walkSlides } from "./helpers/lesson";
import { adminClient, createFamily, deleteUsers, supabaseConfigured, type TestFamily } from "./helpers/supabase";

// Demo target: "Runs on computer, tablet, phone". Every main page, on each device
// project (desktop, tablet, phone): no sideways scrolling, and every control is a
// comfortable tap target (≥ 44 px tall, CLAUDE.md §2).

const MIN_TAP = 44;

async function checkLayout(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const problems = await page.evaluate((min) => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide on a ${vw}px screen`);
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    );
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
      if (el.closest("summary")) continue; // the <summary> row itself is checked below
      if (r.height < min - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("name") || "").trim().slice(0, 40)}" is ${Math.round(r.height)}px tall`);
      if (r.right > vw + 1) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 40)}" goes off screen`);
    }
    for (const s of document.querySelectorAll<HTMLElement>("summary")) {
      const r = s.getBoundingClientRect();
      if (r.height > 0 && r.height < min - 0.5) out.push(`summary "${s.textContent?.trim().slice(0, 40)}" is ${Math.round(r.height)}px tall`);
    }
    return out;
  }, MIN_TAP);
  expect(problems, label).toEqual([]);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${test.info().project.name}-${label.replace(/\W+/g, "_")}.png`, fullPage: true });
}

test.describe("responsive layout on every device", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async () => {
    const admin = adminClient();
    fam = await createFamily(admin, "rsp");
    const id = fam.learner.id;
    const seed = await Promise.all([
      admin.from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), id)),
      admin.from("outcome_status").insert({ learner_id: id, outcome_code: "8PR2", status: "nearly", mastery: 0.67 }),
      admin.from("assessments").insert({ learner_id: id, outcome_code: "8PR2", kind: "exit", score: 0.67, item_results: { mastered: false } }),
      admin.from("schedules").insert({ learner_id: id, weekday: 3, start_time: "19:00", duration_min: 30 }),
      admin.from("reward_rules").insert({ parent_id: fam.parent.id, learner_id: id, outcomes: ["8PR1", "8PR2"], min_score: 0.85, deadline: "2027-06-30", reward_text: "Gift of the learner's choice", value: 50 }),
      admin.from("notifications").insert({ recipient_id: fam.parent.id, type: "idle", payload: { learner_id: id, learner_name: fam.learner.name, slide_no: 4, active_minutes: 8, away_minutes: 5 } }),
    ]);
    for (const r of seed) if (r.error) throw new Error(r.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("public pages", async ({ page }) => {
    for (const path of ["/", "/login", "/signup", "/health"]) {
      await page.goto(path);
      await checkLayout(page, path);
    }
  });

  test("learner pages and the lesson player", async ({ page }) => {
    await page.addInitScript(QUICK_SPEECH);
    await loginLearner(page, fam.learner.username);
    await checkLayout(page, "learner home");
    for (const path of ["/learner/sharing", "/learner/parent-view", "/learner/check"]) {
      await page.goto(path);
      await checkLayout(page, path);
    }
    await page.goto("/learner/lesson");
    await checkLayout(page, "lesson start");
    await page.getByRole("button", { name: "Start lesson" }).click();
    await checkLayout(page, "slide 1");
    await walkSlides(page, 5);
    await checkLayout(page, "slide 5 tiles");
    await walkSlidesFrom5To6(page);
    await checkLayout(page, "slide 6 compare");
    await page.getByRole("button", { name: "Ask a question" }).click();
    await checkLayout(page, "ask panel");
  });

  test("parent pages", async ({ page }) => {
    await loginParent(page, fam.parent.email);
    await checkLayout(page, "parent dashboard");
    const base = `/parent/child/${fam.learner.id}`;
    for (const path of [base, `${base}/rewards`, `${base}/schedule`, `${base}/account`, "/parent/notifications", "/parent/outcomes"]) {
      await page.goto(path);
      await checkLayout(page, path.replace(fam.learner.id, "id"));
    }
    // Vietnamese strings are longer: check the busiest page again.
    await page.goto(base);
    await page.getByRole("button", { name: "Tiếng Việt" }).click();
    await expect(page.getByTestId("this-week")).toContainText("Tuần này");
    await checkLayout(page, "child progress (vi)");
    await page.getByRole("button", { name: "English" }).click();
  });
});

async function walkSlidesFrom5To6(page: Page) {
  const form = page.getByTestId("check-s5");
  await form.getByRole("textbox").fill("6");
  await form.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("slide-progress")).toHaveText("Slide 6 of 9");
}
