import "server-only";
import type { HealthErrorCode, HealthResult, LlmRequest, LlmResult } from "./types";

/**
 * Temporary stand-in provider while no Claude key is available.
 * Synthetic data only (CLAUDE.md §3). Uses the REST API; the key is sent in
 * a header and never logged or returned.
 */

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest";
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

const GeminiSmokePrompt = "Reply with exactly: Gemini API connected.";

type GeminiErrorBody = { error?: { status?: string; details?: { reason?: string }[] } } | null;

export function describeGeminiError(status: number, body: GeminiErrorBody): { code: HealthErrorCode; error: string } {
  const apiStatus = body?.error?.status;
  const badKey = body?.error?.details?.some((d) => d.reason === "API_KEY_INVALID") ?? false;
  if (badKey || status === 401 || apiStatus === "UNAUTHENTICATED") {
    return { code: "invalid_key", error: "The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local." };
  }
  if (status === 400) return { code: "unknown", error: "Gemini rejected the request (HTTP 400)." };
  if (status === 403) return { code: "permission", error: "This Gemini key is not allowed to use this model." };
  if (status === 404) return { code: "model_not_found", error: "Gemini model not found. Check GEMINI_MODEL." };
  if (status === 429) return { code: "rate_limited", error: "Gemini rate limit reached. Wait a minute and try again." };
  return { code: "unknown", error: `Gemini API error (HTTP ${status}). Try again later.` };
}

/** Backup model when the main one is busy or out of free-tier quota (Flash: 20 requests/day free). */
export function geminiFallbackModel(): string {
  return process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.1-flash-lite";
}

/** Busy, out of quota, server error, timeout or a retired model: worth trying the backup model. */
function retryable(r: LlmResult): boolean {
  return !r.ok && (r.code === "network" || r.code === "model_not_found" || r.code === "rate_limited" || /HTTP 5\d\d/.test(r.error));
}

export async function geminiGenerate(req: LlmRequest): Promise<LlmResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  const primary = geminiModel();
  if (!key) return { ok: false, provider: "gemini", model: primary, code: "missing_key", error: "AI not connected yet." };

  const first = await callGemini(primary, key, req);
  const backup = geminiFallbackModel();
  if (!retryable(first) || backup === primary) return first;
  return callGemini(backup, key, req);
}

async function callGemini(model: string, key: string, req: LlmRequest): Promise<LlmResult> {
  const provider = "gemini";
  try {
    const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: [{ text: req.user }, ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } }))],
          },
        ],
        generationConfig: {
          // Newer Gemini models spend output tokens on thinking, so leave headroom.
          maxOutputTokens: Math.max(req.maxTokens, 2048),
          temperature: 0.4,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, provider, model, ...describeGeminiError(res.status, body as GeminiErrorBody) };
    }
    const data = body as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      return { ok: false, provider, model, code: "refusal", error: "The model declined to answer." };
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return { ok: false, provider, model, code: "unknown", error: "Gemini returned an empty reply." };
    return { ok: true, provider, model, text };
  } catch (err) {
    const timeout = err instanceof DOMException && err.name === "TimeoutError";
    return {
      ok: false,
      provider,
      model,
      code: "network",
      error: timeout ? "Gemini took too long to answer." : "Could not reach the Gemini API.",
    };
  }
}

export async function geminiHealthCheck(): Promise<HealthResult> {
  const model = geminiModel();
  if (!hasGeminiKey()) {
    return {
      ok: false,
      provider: "gemini",
      model,
      code: "missing_key",
      error: "API key not set yet. Add GEMINI_API_KEY to .env.local and restart the dev server.",
    };
  }
  const r = await geminiGenerate({ system: "Follow the instruction exactly.", user: GeminiSmokePrompt, maxTokens: 50, json: false });
  return r.ok
    ? { ok: true, provider: "gemini", model: r.model, reply: r.text }
    : { ok: false, provider: "gemini", model: r.model, code: r.code, error: r.error };
}
