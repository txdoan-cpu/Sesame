import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Tests that talk to Supabase directly read the same .env.local as the app.
loadEnvConfig(process.cwd());

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Runs against the production build (`npm run build` first).
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Deterministic answers in tests; real providers are checked by `npm run eval:ask`.
    env: { LLM_PROVIDER: "mock" },
    timeout: 120_000,
  },
});
