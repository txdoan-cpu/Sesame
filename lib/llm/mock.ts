import "server-only";
import { mockAuthor, mockCritic } from "@/lib/generation/mock";
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
  if (req.user.includes('"task":"rubric_r"')) return { ...base, text: mockRubric(req.user) };
  if (req.user.includes('"task":"author_lesson"')) return { ...base, text: mockAuthor(req.user) };
  if (req.user.includes('"task":"critic_s"')) return { ...base, text: mockCritic() };
  if (req.images?.length && req.user.startsWith("Transcribe")) return { ...base, text: "Solve 2x + 3 = 11. Subtract 3 from both sides, then divide by 2." };
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

/**
 * Rubric R stand-in: everything 3, except predictable cases tests rely on:
 * "WRONG" in the text → R3 = 1 (inaccurate); licence "other" without a note → R9 = 1;
 * "OFF-TOPIC" → R1 = 1; no source URL → R5 = 2.
 */
function mockRubric(user: string): string {
  type P = { material?: { text?: string; licence?: string; licence_note?: string | null; source_url?: string | null } };
  let p: P = {};
  try {
    p = JSON.parse(user) as P;
  } catch {
    // keep defaults
  }
  const m = p.material ?? {};
  const text = m.text ?? "";
  const scores: Record<string, number> = { R1: 3, R2: 3, R3: 3, R4: 3, R5: 3, R6: 2, R7: 3, R8: 2, R9: 3, R10: 3 };
  const reasons: Record<string, string> = {};
  if (text.includes("WRONG")) {
    scores.R3 = 1;
    reasons.R3 = "A worked answer is wrong.";
  }
  if (text.includes("OFF-TOPIC")) {
    scores.R1 = 1;
    reasons.R1 = "The material is about a different topic.";
  }
  if (m.licence === "other" && !m.licence_note) {
    scores.R9 = 1;
    reasons.R9 = "The licence is unclear.";
  }
  if (!m.source_url) {
    scores.R5 = 2;
    reasons.R5 = "No source link; uploaded by a teacher.";
  }
  return JSON.stringify({ scores, reasons, summary: "Mock review for tests." });
}
