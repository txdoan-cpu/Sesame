import "server-only";
import type { HealthResult } from "./types";

/**
 * Temporary stand-in provider (synthetic data only). Not wired up in Round 0;
 * set LLM_PROVIDER=claude (the default) to use Claude.
 */
export async function geminiHealthCheck(): Promise<HealthResult> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini";
  return {
    ok: false,
    provider: "gemini",
    model,
    code: "provider_not_ready",
    error: "The Gemini fallback is not set up yet. Set LLM_PROVIDER=claude.",
  };
}
