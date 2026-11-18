import { expect, test } from "@playwright/test";

test("home page loads and links to /health", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Sesame" })).toBeVisible();
  await page.getByRole("link", { name: /Claude API connection/ }).click();
  await expect(page).toHaveURL(/\/health$/);
});

test("/health shows a reply from Claude or a clear 'API key not set yet' message", async ({ page }) => {
  await page.goto("/health");
  const reply = page.getByTestId("health-reply");
  const missingKey = page.getByRole("heading", { name: "API key not set yet" });
  await expect(reply.or(missingKey)).toBeVisible({ timeout: 30_000 });
});

test("/api/health/claude never returns the key", async ({ request }) => {
  const res = await request.get("/api/health/claude");
  const text = await res.text();
  expect(text).not.toMatch(/sk-ant-/);
  const json = JSON.parse(text) as { ok: boolean };
  expect(typeof json.ok).toBe("boolean");
});
