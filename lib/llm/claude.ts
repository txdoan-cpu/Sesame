import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { HealthResult, LlmRequest, LlmResult } from "./types";
import { describeClaudeError } from "./errors";

export const SMOKE_TEST_PROMPT = "Reply with exactly: Claude API connected.";

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
}

export function hasClaudeKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Round 0 smoke test: one short prompt, max_tokens 50. */
export async function claudeHealthCheck(): Promise<HealthResult> {
  const model = claudeModel();
  const provider = "claude";

  if (!hasClaudeKey()) {
    return {
      ok: false,
      provider,
      model,
      code: "missing_key",
      error: "API key not set yet. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.",
    };
  }

  try {
    // Key is read from ANTHROPIC_API_KEY by the SDK; it is never logged or returned.
    const client = new Anthropic({ maxRetries: 1, timeout: 20_000 });
    const response = await client.messages.create({
      model,
      max_tokens: 50,
      messages: [{ role: "user", content: SMOKE_TEST_PROMPT }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, provider, model, code: "refusal", error: "Claude declined the test prompt." };
    }

    const reply = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();

    return { ok: true, provider, model: response.model, reply: reply || "(empty reply)" };
  } catch (err) {
    const { code, error } = describeClaudeError(err);
    return { ok: false, provider, model, code, error };
  }
}

/** One Claude call for /api/ask. Server only; the key never leaves the server. */
export async function claudeGenerate(req: LlmRequest): Promise<LlmResult> {
  const model = claudeModel();
  const provider = "claude";
  if (!hasClaudeKey()) {
    return { ok: false, provider, model, code: "missing_key", error: "AI not connected yet." };
  }
  try {
    const client = new Anthropic({ maxRetries: 1, timeout: req.timeoutMs ?? 20_000 });
    const response = await client.messages.create({
      model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            ...(req.images ?? []).map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: img.base64 },
            })),
            { type: "text" as const, text: req.user },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, provider, model, code: "refusal", error: "The model declined to answer." };
    }
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    return { ok: true, provider, model: response.model, text };
  } catch (err) {
    const { code, error } = describeClaudeError(err);
    return { ok: false, provider, model, code, error };
  }
}
