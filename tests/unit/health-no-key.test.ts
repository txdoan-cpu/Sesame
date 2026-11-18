import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("claudeHealthCheck without a key", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the 'API key not set yet' message and makes no network call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { claudeHealthCheck } = await import("@/lib/llm/claude");

    const result = await claudeHealthCheck();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_key");
      expect(result.error).toMatch(/API key not set yet/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
