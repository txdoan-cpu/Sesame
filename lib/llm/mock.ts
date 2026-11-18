import "server-only";
import type { HealthResult, LlmRequest, LlmResult } from "./types";

/**
 * Deterministic stand-in for tests and offline demos (LLM_PROVIDER=mock).
 * Reads the ask payload (JSON) and answers about the current slide.
 * Magic words in the question let tests exercise the guards:
 *   #matherror -> states a wrong value for an equation
 *   #leak      -> gives away an exit-ticket answer
 *   #badjson   -> returns text that is not JSON
 */
export async function mockGenerate(req: LlmRequest): Promise<LlmResult> {
  const base = { ok: true as const, provider: "mock", model: "mock-1" };
  let payload: { question?: string; slide?: { title?: string; indicators?: string[] }; exit_ticket_equations?: string[] } = {};
  try {
    payload = JSON.parse(req.user) as typeof payload;
  } catch {
    // Not an ask payload.
  }
  const q = (payload.question ?? "").toLowerCase();
  const title = payload.slide?.title ?? "this slide";

  if (q.includes("#badjson")) return { ...base, text: "Sorry, here is some plain text instead of JSON." };

  if (q.includes("#matherror")) {
    return {
      ...base,
      text: JSON.stringify({
        answer: "Take away 4 from both sides. Then 3x = 15, so x = 7.",
        check_question: "Does that make sense?",
        indicator: "PR2.3",
        misconception: null,
        math_claims: [{ equation: "3x + 4 = 19", x: 7 }],
        safety_concern: false,
      }),
    };
  }

  if (q.includes("#leak")) {
    const eq = payload.exit_ticket_equations?.[0] ?? "4x + 3 = 23";
    return {
      ...base,
      text: JSON.stringify({
        answer: `For ${eq}, the answer is x = 5.`,
        check_question: "Got it?",
        indicator: "PR2.3",
        misconception: null,
        math_claims: [{ equation: eq, x: 5 }],
        safety_concern: false,
      }),
    };
  }

  const confused = /don'?t get|confus|lost|hard/.test(q);
  const answer = confused
    ? `Let's try it another way, with a balance scale. On "${title}", both sides must stay level. Do one small step at a time, and do it to both sides.`
    : `Good question about "${title}". The big idea: whatever you do to one side, do to the other side too. That keeps it balanced.`;

  return {
    ...base,
    text: JSON.stringify({
      answer,
      check_question: "What would you do first to both sides?",
      indicator: payload.slide?.indicators?.[0] ?? null,
      misconception: confused ? "M1" : null,
      math_claims: [],
      safety_concern: false,
    }),
  };
}

export async function mockHealthCheck(): Promise<HealthResult> {
  return { ok: true, provider: "mock", model: "mock-1", reply: "Mock provider connected." };
}
