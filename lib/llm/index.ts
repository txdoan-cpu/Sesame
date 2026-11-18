import "server-only";
import { claudeGenerate, claudeHealthCheck, hasClaudeKey } from "./claude";
import { geminiGenerate, geminiHealthCheck, hasGeminiKey } from "./gemini";
import { mockGenerate, mockHealthCheck } from "./mock";
import type { HealthResult, LlmRequest, LlmResult } from "./types";

export type LlmProvider = "claude" | "gemini" | "mock";

/**
 * Picks the provider from LLM_PROVIDER (default: claude).
 * "gemini" is a temporary stand-in, "mock" is for tests; both synthetic data only.
 */
export function llmProvider(): LlmProvider {
  const value = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return value === "gemini" ? "gemini" : value === "mock" ? "mock" : "claude";
}

/** True when the chosen provider has what it needs (§12: show "AI not connected yet" otherwise). */
export function llmConfigured(): boolean {
  switch (llmProvider()) {
    case "claude":
      return hasClaudeKey();
    case "gemini":
      return hasGeminiKey();
    case "mock":
      return true;
  }
}

export async function llmGenerate(req: LlmRequest): Promise<LlmResult> {
  switch (llmProvider()) {
    case "claude":
      return claudeGenerate(req);
    case "gemini":
      return geminiGenerate(req);
    case "mock":
      return mockGenerate(req);
  }
}

export async function healthCheck(): Promise<HealthResult> {
  switch (llmProvider()) {
    case "claude":
      return claudeHealthCheck();
    case "gemini":
      return geminiHealthCheck();
    case "mock":
      return mockHealthCheck();
  }
}

export type { HealthResult, LlmRequest, LlmResult } from "./types";
