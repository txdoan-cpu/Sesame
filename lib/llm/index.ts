import "server-only";
import { claudeHealthCheck } from "./claude";
import { geminiHealthCheck } from "./gemini";
import type { HealthResult } from "./types";

export type LlmProvider = "claude" | "gemini";

/** Picks the provider from LLM_PROVIDER (default: claude). */
export function llmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "claude";
}

export async function healthCheck(): Promise<HealthResult> {
  return llmProvider() === "gemini" ? geminiHealthCheck() : claudeHealthCheck();
}

export type { HealthResult } from "./types";
