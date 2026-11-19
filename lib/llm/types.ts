import { z } from "zod";

/** Result of the Round 0 smoke test. Never contains a key. */
export const HealthResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    provider: z.string(),
    model: z.string(),
    reply: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    provider: z.string(),
    model: z.string(),
    /** Stable code the UI can switch on. */
    code: z.enum([
      "missing_key",
      "invalid_key",
      "no_credit",
      "permission",
      "model_not_found",
      "rate_limited",
      "network",
      "refusal",
      "provider_not_ready",
      "unknown",
    ]),
    /** Readable message for the owner. */
    error: z.string(),
  }),
]);

export type HealthResult = z.infer<typeof HealthResultSchema>;
export type HealthErrorCode = Extract<HealthResult, { ok: false }>["code"];

/** One model call: a system prompt and one user message. */
export type LlmRequest = {
  system: string;
  user: string;
  maxTokens: number;
  /** Ask the provider for a JSON object (we still parse defensively). */
  json: boolean;
  timeoutMs?: number;
  /** Optional images sent with the user message (e.g. a scanned worksheet). */
  images?: { mimeType: string; base64: string }[];
};

export type LlmResult =
  | { ok: true; text: string; provider: string; model: string }
  | { ok: false; code: HealthErrorCode; error: string; provider: string; model: string };
