import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Evaluations that call the real model provider (LLM_PROVIDER in .env.local).
// Run with `npm run eval:ask`. Not part of `npm run test`.
// Next.js skips .env.local when NODE_ENV=test, so load it here instead.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/eval/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/eval/**/*.eval.ts"],
    environment: "node",
    env: loadEnv("development", process.cwd(), ""),
    testTimeout: 300_000,
  },
});
