import { expect, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "./supabase";

export const E2E_CRON_SECRET = "e2e-cron-secret";

export async function loginLearner(page: Page, username: string) {
  await page.goto("/login");
  const form = page.getByTestId("learner-login");
  await form.getByLabel("Username").fill(username);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/learner$/);
}

export async function loginParent(page: Page, email: string) {
  await page.goto("/login");
  const form = page.getByTestId("parent-login");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(TEST_PASSWORD);
  await form.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/parent$/);
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
