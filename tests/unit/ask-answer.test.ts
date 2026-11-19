import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import raw from "@/content/lessons/8PR2-demo-A.json";
import { LessonSchema } from "@/lib/lesson/schema";
import type { AskContext } from "@/lib/ask/answer";

vi.mock("server-only", () => ({}));

const lesson = LessonSchema.parse(raw);

function ctx(question: string, slideNo = 3): AskContext {
  return {
    lesson,
    slideNo,
    outcome: { code: "8PR2", description: "Solve linear equations" },
    indicators: ["PR2.1", "PR2.2", "PR2.3", "PR2.4", "PR2.5", "PR2.6"].map((code) => ({ code, description: code })),
    misconceptions: ["M1", "M2", "M3", "M4", "M5"].map((code) => ({ code, description: code })),
    learner: { reading_level: "grade 6", interests: ["hockey"], misconceptions: ["M2", "M3"] },
    history: [],
    question,
  };
}

// The first import pulls in mathjs and the LLM layer; under a busy parallel run it can take
// several seconds, so load it once up front instead of inside a 5-second test.
beforeAll(async () => {
  await import("@/lib/ask/answer");
}, 60_000);

describe("answerQuestion with the mock provider", () => {
  beforeEach(() => vi.stubEnv("LLM_PROVIDER", "mock"));
  afterEach(() => vi.unstubAllEnvs());

  it("answers in the context of the current slide with a check question", async () => {
    const { answerQuestion } = await import("@/lib/ask/answer");
    const r = await answerQuestion(ctx("why take away 4?"));
    expect(r.kind).toBe("answer");
    if (r.kind !== "answer") return;
    expect(r.answer).toContain("Worked example: skate rental");
    expect(r.checkQuestion).toMatch(/\?$/);
    expect(r.indicator).toBe("PR2.3");
    expect(r.fallback).toBeNull();
  });

  it("stops at the safety screen before calling the model", async () => {
    const llm = await import("@/lib/llm");
    const spy = vi.spyOn(llm, "llmGenerate");
    const { answerQuestion } = await import("@/lib/ask/answer");
    const r = await answerQuestion(ctx("kids keep bullying me"));
    expect(r).toEqual({ kind: "safety", category: "bullying" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("replaces a wrong math claim with a safe fallback", async () => {
    const { answerQuestion } = await import("@/lib/ask/answer");
    const r = await answerQuestion(ctx("#matherror what is x"));
    expect(r).toMatchObject({ kind: "answer", fallback: "math" });
    if (r.kind === "answer") expect(r.answer).not.toContain("x = 7");
  });

  it("never gives away an exit-ticket answer", async () => {
    const { answerQuestion } = await import("@/lib/ask/answer");
    const r = await answerQuestion(ctx("#leak what's the answer to number 1", 9));
    expect(r).toMatchObject({ kind: "answer", fallback: "leak" });
    if (r.kind === "answer") expect(r.answer).not.toMatch(/x\s*=\s*5/);
  });

  it("falls back gracefully when the model does not return JSON", async () => {
    const { answerQuestion } = await import("@/lib/ask/answer");
    const r = await answerQuestion(ctx("#badjson hi"));
    expect(r).toMatchObject({ kind: "answer", fallback: "parse" });
  });
});

describe("answerQuestion with no key (§12)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["claude", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
  ])("%s without a key -> ai_not_connected, no network call", async (provider, keyVar) => {
    vi.stubEnv("LLM_PROVIDER", provider);
    vi.stubEnv(keyVar, "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { answerQuestion } = await import("@/lib/ask/answer");
    expect(await answerQuestion(ctx("why?"))).toEqual({ kind: "error", code: "ai_not_connected" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("safety still works with no key", async () => {
    vi.stubEnv("LLM_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { answerQuestion } = await import("@/lib/ask/answer");
    expect(await answerQuestion(ctx("I want to hurt myself"))).toEqual({ kind: "safety", category: "self_harm" });
  });
});

describe("gemini error mapping", () => {
  it("maps a bad key, rate limit and missing model", async () => {
    const { describeGeminiError } = await import("@/lib/llm/gemini");
    expect(describeGeminiError(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }).code).toBe("invalid_key");
    expect(describeGeminiError(429, null).code).toBe("rate_limited");
    expect(describeGeminiError(404, null).code).toBe("model_not_found");
    expect(describeGeminiError(400, { error: { status: "INVALID_ARGUMENT" } }).code).toBe("unknown");
  });
});
