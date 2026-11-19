import { expect, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "./supabase";

export const E2E_CRON_SECRET = "e2e-cron-secret";

/**
 * Logs in through the real login form. Supabase Auth rate-limits sign-ins per IP; when the
 * form says "Too many tries", wait and submit again instead of failing the test.
 */
async function loginWithForm(page: Page, formId: string, fields: Record<string, string>, home: RegExp) {
  await page.goto("/login");
  const form = page.getByTestId(formId);
  for (const [label, value] of Object.entries(fields)) await form.getByLabel(label).fill(value);
  for (let attempt = 0; attempt < 8; attempt++) {
    await form.getByRole("button", { name: "Log in" }).click();
    // Either we land on the home page, or the form shows an error.
    await page.waitForURL(home, { timeout: 15_000 }).catch(() => {});
    if (home.test(page.url())) return;
    const tooMany = await form.getByRole("alert").filter({ hasText: "Too many tries" }).isVisible();
    if (!tooMany) break;
    await page.waitForTimeout(20_000);
  }
  await expect(page).toHaveURL(home);
}

export async function loginLearner(page: Page, username: string, password = TEST_PASSWORD) {
  await loginWithForm(page, "learner-login", { Username: username, Password: password }, /\/learner$/);
}

export async function loginParent(page: Page, email: string, password = TEST_PASSWORD) {
  await loginWithForm(page, "parent-login", { Email: email, Password: password }, /\/parent$/);
}

export async function answer(page: Page, id: string, value: string) {
  const form = page.getByTestId(`check-${id}`);
  await form.getByRole("textbox").fill(value);
  await form.getByRole("button", { name: "Check" }).click();
  await expect(form).toContainText(/Yes|The answer is/);
}

export async function expectSlide(page: Page, n: number) {
  await expect(page.getByTestId("slide-progress")).toHaveText(`Slide ${n} of 9`);
}

const next = (page: Page) => page.getByRole("button", { name: "Next", exact: true }).click();

/** Walks slides 1..`upTo` answering every check-in correctly; stops on slide `upTo`. */
export async function walkSlides(page: Page, upTo: number) {
  const steps: Record<number, () => Promise<void>> = {
    1: async () => {
      await answer(page, "s1a", "5");
      await answer(page, "s1b", "5");
    },
    2: async () => page.getByRole("button", { name: "The scale tips. It is not balanced any more." }).click(),
    4: async () => answer(page, "s4", "5"),
    5: async () => answer(page, "s5", "6"),
    6: async () => page.getByRole("button", { name: "Maya. The 2 multiplies the x and the 3." }).click(),
    7: async () => answer(page, "s7", "-10"),
    8: async () => {
      await answer(page, "s8a", "-4");
      await answer(page, "s8b", "6");
      await answer(page, "s8c", "5");
    },
  };
  for (let n = 1; n < upTo; n++) {
    await expectSlide(page, n);
    await steps[n]?.();
    await next(page);
  }
  await expectSlide(page, upTo);
}

/** Exit ticket (or memory check) with every answer right and the balance explanation. */
export async function answerExitAllRight(page: Page, submitLabel = "Finish lesson") {
  const exit = page.getByTestId("exit-ticket");
  await page.getByTestId("exit-e1").getByLabel("x = 5", { exact: true }).check();
  await page.getByTestId("exit-e2").getByLabel("x = 3", { exact: true }).check();
  await page.getByTestId("exit-e3").getByLabel("Take away 5 from the right side too, to keep it balanced.").check();
  await exit.getByRole("textbox").fill("Do the same thing to both sides so it stays balanced.");
  await exit.getByRole("button", { name: submitLabel }).click();
  await expect(page.getByTestId("lesson-results")).toContainText("You got 3 out of 3.");
}

/** Makes speech synthesis finish instantly in headless browsers (narration must not block timers). */
export const QUICK_SPEECH = `
  if (window.speechSynthesis) {
    window.speechSynthesis.speak = (u) => {
      setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 20); }, 5);
    };
    window.speechSynthesis.cancel = () => {};
  }
`;
