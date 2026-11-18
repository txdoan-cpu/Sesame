import Anthropic from "@anthropic-ai/sdk";
import type { HealthErrorCode } from "./types";

/**
 * Turn an SDK error into a readable message. Never includes the key.
 * Order matters: APIConnectionError is a subclass of APIError in the TS SDK.
 */
export function describeClaudeError(err: unknown): { code: HealthErrorCode; error: string } {
  if (err instanceof Anthropic.APIConnectionError) {
    return {
      code: "network",
      error: "Could not reach the Claude API. Check your internet connection and try again.",
    };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return {
      code: "invalid_key",
      error: "The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.",
    };
  }
  if (err instanceof Anthropic.APIError) {
    const lowCredit =
      err.type === "billing_error" ||
      err.status === 402 ||
      // Older accounts report low credit as a 400 with this wording.
      (err.status === 400 && /credit balance/i.test(err.apiMessage ?? ""));
    if (lowCredit) {
      return {
        code: "no_credit",
        error: "The account has no API credit. Add credit in the Claude Console billing page.",
      };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { code: "permission", error: "This API key is not allowed to use this model." };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return {
        code: "model_not_found",
        error: "Model not found. Check ANTHROPIC_MODEL against https://docs.claude.com.",
      };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { code: "rate_limited", error: "Too many requests. Wait a minute and try again." };
    }
    return {
      code: "unknown",
      error: `Claude API error (HTTP ${err.status ?? "?"}). Try again later.`,
    };
  }
  return { code: "unknown", error: "Unexpected error while calling Claude." };
}
