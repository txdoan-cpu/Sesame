import { expect, test, type Page } from "@playwright/test";
import demoA from "@/content/profiles/demo-A.json";
import { LearnerProfileSchema, toLearnerProfileRow } from "@/lib/learner-profile";
import { adminClient, createFamily, deleteUsers, signedIn, supabaseConfigured, TEST_PASSWORD, type TestFamily } from "./helpers/supabase";
import { loginLearner } from "./helpers/lesson";

// Round 4: voice/typed questions during the lesson, math check, safety.
// The server runs with LLM_PROVIDER=mock (see playwright.config.ts).

/** Fake Web Speech API: each start() "hears" window.__say. Audio is never involved. */
const FAKE_SPEECH = `
  window.__say = "";
  class FakeRecognition {
    start() {
      const text = window.__say;
      setTimeout(() => {
        if (text) this.onresult && this.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
        this.onend && this.onend();
      }, 30);
    }
    stop() {}
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
`;

test.describe("voice Q&A", () => {
  test.skip(!supabaseConfigured, "Supabase is not configured in .env.local");
  test.describe.configure({ mode: "serial" });

  let fam: TestFamily;

  test.beforeAll(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once");
    const admin = adminClient();
    fam = await createFamily(admin, "ask");
    const p = await admin.from("learner_profiles").insert(toLearnerProfileRow(LearnerProfileSchema.parse(demoA), fam.learner.id));
    if (p.error) throw new Error(p.error.message);
  });

  test.afterAll(async () => {
    if (fam) await deleteUsers(adminClient(), [fam.parent.id, fam.learner.id]);
  });

  test("spoken question pauses the lesson, gets an answer about the slide, then resumes", async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH);
    await startLesson(page, fam.learner.username);

    await page.evaluate(() => ((window as unknown as { __say: string }).__say = "why do we divide by 4"));
    await page.getByRole("button", { name: "Ask a question" }).click();

    const panel = page.getByTestId("ask-panel");
    await expect(panel.getByTestId("ask-answer")).toContainText("Warm-up");
    await expect(panel).toContainText("You asked: why do we divide by 4");
    await expect(panel.getByTestId("ask-check")).toHaveText(/\?$/);

    // "Was this helpful?" is saved on the question.
    await panel.getByTestId("ask-helpful").getByRole("button", { name: "Yes, it helped" }).click();
    await expect(panel.getByTestId("ask-helpful")).toContainText("Thanks for telling me!");
    await expect
      .poll(async () => (await adminClient().from("questions").select("helpful").eq("learner_id", fam.learner.id).single()).data?.helpful)
      .toBe(true);

    await panel.getByRole("button", { name: "Continue lesson" }).click();
    await expect(page.getByTestId("ask-panel")).toHaveCount(0);
    await expect(page.getByTestId("slide-progress")).toHaveText("Slide 1 of 9");

    const q = await adminClient().from("questions").select("text, answer, indicator, slide_no, fallback").eq("learner_id", fam.learner.id);
    expect(q.data).toEqual([
      expect.objectContaining({ text: "why do we divide by 4", slide_no: 1, indicator: "PR2.3", fallback: false }),
    ]);
    expect(q.data?.[0].answer).toContain("Warm-up");
  });

  test("typed question works; a wrong math claim is replaced by a safe fallback", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    });
    await startLesson(page, fam.learner.username);
    await page.getByRole("button", { name: "Ask a question" }).click();
    const panel = page.getByTestId("ask-panel");
    await expect(panel.getByTestId("ask-note")).toContainText("Type your question");

    await panel.getByLabel("Or type your question").fill("#matherror so what is x");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(panel.getByTestId("ask-answer")).toContainText("Let me not guess");
    await expect(panel).not.toContainText("x = 7");

    const q = await adminClient().from("questions").select("fallback").eq("learner_id", fam.learner.id).eq("text", "#matherror so what is x");
    expect(q.data).toEqual([{ fallback: true }]);
  });

  test("check-ins can be answered by voice", async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH);
    await startLesson(page, fam.learner.username);
    const check = page.getByTestId("check-s1a");
    await page.evaluate(() => ((window as unknown as { __say: string }).__say = "x equals five"));
    await check.getByRole("button", { name: "Say it" }).click();
    await expect(check).toContainText("Yes! x = 5");
    await expect(check.getByRole("textbox")).toHaveValue("x equals five");
  });

  test("a safety question stops the lesson and alerts the parent", async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH);
    await startLesson(page, fam.learner.username);
    await page.getByRole("button", { name: "Ask a question" }).click();
    const panel = page.getByTestId("ask-panel");
    await panel.getByLabel("Or type your question").fill("the kids at school bully me every day");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();

    const msg = page.getByTestId("safety-message");
    await expect(msg).toContainText("trusted adult");
    await expect(msg).toContainText("1-800-668-6868");
    await expect(page.getByTestId("lesson-player")).toHaveCount(0);
    await expect(msg.getByRole("link", { name: "Back to my goals" })).toBeVisible();

    // The parent receives a safety notification (and can read it); the learner cannot read it.
    const parent = await signedIn(fam.parent.email);
    const n = await parent.from("notifications").select("type, payload").eq("type", "safety");
    expect(n.data).toHaveLength(1);
    expect(n.data?.[0].payload).toMatchObject({ category: "bullying", learner_id: fam.learner.id, slide_no: 1 });

    const learner = await signedIn(`${fam.learner.username}@learners.sesame.invalid`);
    expect((await learner.from("notifications").select("id")).data).toEqual([]);

    const q = await adminClient().from("questions").select("safety_category, answer").eq("learner_id", fam.learner.id).eq("safety_category", "bullying");
    expect(q.data).toEqual([{ safety_category: "bullying", answer: null }]);
  });

  test("possible abuse: lesson stops, parent is NOT notified, a review is recorded", async ({ page }) => {
    await startLesson(page, fam.learner.username);
    await page.getByRole("button", { name: "Ask a question" }).click();
    const panel = page.getByTestId("ask-panel");
    await panel.getByLabel("Or type your question").fill("my dad hits me when I get it wrong");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();

    const msg = page.getByTestId("safety-message");
    await expect(msg).toContainText("school counsellor");
    await expect(msg).not.toContainText("parent");

    const admin = adminClient();
    const n = await admin.from("notifications").select("payload").eq("type", "safety").eq("recipient_id", fam.parent.id);
    expect((n.data ?? []).filter((r) => (r.payload as { category?: string }).category === "abuse")).toEqual([]);

    const reviews = await admin.from("safety_reviews").select("category, question_id").eq("learner_id", fam.learner.id);
    expect(reviews.data).toHaveLength(1);
    expect(reviews.data?.[0].category).toBe("abuse");
    expect(reviews.data?.[0].question_id).toBeTruthy();

    // Neither the parent nor the learner can read safety reviews.
    expect((await (await signedIn(fam.parent.email)).from("safety_reviews").select("id")).data ?? []).toEqual([]);
    expect((await (await signedIn(`${fam.learner.username}@learners.sesame.invalid`)).from("safety_reviews").select("id")).data ?? []).toEqual([]);
  });

  test("/api/ask is for signed-in learners only", async ({ request, page }) => {
    const body = { lessonId: "8PR2-demo-A", slideNo: 1, question: "hi" };
    expect((await request.post("/api/ask", { data: body })).status()).toBe(401);

    // A parent session is refused too.
    await page.goto("/login");
    const form = page.getByTestId("parent-login");
    await form.getByLabel("Email").fill(fam.parent.email);
    await form.getByLabel("Password").fill(TEST_PASSWORD);
    await form.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/parent$/);
    expect((await page.request.post("/api/ask", { data: body })).status()).toBe(401);
  });

  test("bad input is rejected", async ({ page }) => {
    await startLesson(page, fam.learner.username);
    const bad = await page.request.post("/api/ask", { data: { lessonId: "8PR2-demo-A", slideNo: 99, question: "hi" } });
    expect(bad.status()).toBe(400);
    const empty = await page.request.post("/api/ask", { data: { lessonId: "8PR2-demo-A", slideNo: 1, question: "   " } });
    expect(empty.status()).toBe(400);
  });
});

async function startLesson(page: Page, username: string) {
  await loginLearner(page, username);
  await page.goto("/learner/lesson");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await expect(page.getByTestId("slide-progress")).toHaveText("Slide 1 of 9");
}
