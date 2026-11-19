import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Tests that talk to Supabase directly read the same .env.local as the app.
loadEnvConfig(process.cwd());

const PORT = 3100;
/** Secret the test server expects on /api/cron/engagement (tests/e2e/helpers/lesson.ts uses the same). */
const E2E_CRON_SECRET = "e2e-cron-secret";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["Galaxy Tab S4"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Runs against the production build (`npm run build` first).
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Deterministic answers in tests; real providers are checked by `npm run eval:ask`.
    env: { LLM_PROVIDER: "mock", CRON_SECRET: E2E_CRON_SECRET, ALLOW_TEST_CLOCK: "1" },
    timeout: 120_000,
  },
});
