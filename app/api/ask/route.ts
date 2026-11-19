import { connection } from "next/server";
import { z } from "zod";
import { answerQuestion } from "@/lib/ask/answer";
import { loadAskContext } from "@/lib/ask/context";
import { getCurrentUser } from "@/lib/auth/dal";
import { getLesson } from "@/lib/lesson/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safetyMessage, safetyRoute } from "@/lib/llm/safety";
import { llmProvider } from "@/lib/llm";

// POST /api/ask: a learner's spoken or typed question during a lesson (CLAUDE.md §7.2).
// Only text is received and stored; audio never leaves the browser.

const InputSchema = z.object({
  lessonId: z.string().max(100),
  slideNo: z.number().int().min(1).max(50),
  question: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({ question: z.string().max(500), answer: z.string().max(1500) }))
    .max(3)
    .default([]),
});

export type AskResponse =
  | { ok: true; kind: "answer"; answer: string; checkQuestion: string; fallback: boolean; questionId: string | null }
  | { ok: true; kind: "safety"; message: string }
  | { ok: false; code: "not_signed_in" | "invalid_input" | "ai_not_connected" | "rate_limited" | "unavailable" };

// Simple per-learner limit to protect free-tier quotas (in memory; one server).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const recent = new Map<string, number[]>();
function rateLimited(userId: string, now: number): boolean {
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(userId, hits);
  return hits.length > MAX_PER_WINDOW;
}

function reply(body: AskResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await connection();
  const user = await getCurrentUser();
  if (!user || user.role !== "learner") return reply({ ok: false, code: "not_signed_in" }, 401);

  const parsed = InputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ ok: false, code: "invalid_input" }, 400);
  const input = parsed.data;
  const lesson = getLesson(input.lessonId);
  if (!lesson || !lesson.slides.some((s) => s.no === input.slideNo)) return reply({ ok: false, code: "invalid_input" }, 400);

  if (rateLimited(user.id, Date.now())) return reply({ ok: false, code: "rate_limited" }, 429);

  const ctx = await loadAskContext(await createClient(), user.id, lesson.outcome_code);
  const outcome = await answerQuestion({ ...ctx, lesson, slideNo: input.slideNo, history: input.history, question: input.question });
  const admin = createAdminClient();

  if (outcome.kind === "safety") {
    const saved = await admin
      .from("questions")
      .insert({
        learner_id: user.id,
        lesson_id: lesson.id,
        slide_no: input.slideNo,
        text: input.question,
        safety_category: outcome.category,
      })
      .select("id")
      .single();

    if (safetyRoute(outcome.category) === "review_only") {
      // Possible abuse: the parent is not told; a responsible adult reviews it (owner decision, §7.2).
      const r = await admin.from("safety_reviews").insert({
        learner_id: user.id,
        question_id: saved.data?.id ?? null,
        category: outcome.category,
        lesson_id: lesson.id,
        slide_no: input.slideNo,
      });
      if (r.error) console.error("safety review insert failed:", r.error.message);
      return reply({ ok: true, kind: "safety", message: safetyMessage(outcome.category) });
    }

    // Other safety alerts are locked and always shared (§7.3): notify every linked parent.
    const { data: links } = await admin.from("family_links").select("parent_id").eq("learner_id", user.id);
    const rows = (links ?? []).map((l) => ({
      recipient_id: l.parent_id as string,
      type: "safety",
      payload: { learner_id: user.id, learner_name: user.displayName, category: outcome.category, lesson_id: lesson.id, slide_no: input.slideNo },
    }));
    if (rows.length) {
      const n = await admin.from("notifications").insert(rows);
      if (n.error) console.error("safety notification failed:", n.error.message);
    }
    return reply({ ok: true, kind: "safety", message: safetyMessage(outcome.category) });
  }

  if (outcome.kind === "error") {
    return reply({ ok: false, code: outcome.code }, outcome.code === "rate_limited" ? 429 : 503);
  }

  if (outcome.fallback) {
    // Logged without the learner's text; details are in the questions row.
    console.warn(`ask fallback (${outcome.fallback}) via ${outcome.provider}: ${outcome.failures.join("; ")}`);
  }
  const saved = await admin.from("questions").insert({
    learner_id: user.id,
    lesson_id: lesson.id,
    slide_no: input.slideNo,
    text: input.question,
    answer: outcome.answer,
    indicator: outcome.indicator,
    misconception: outcome.misconception,
    fallback: outcome.fallback !== null,
    provider: llmProvider(),
  }).select("id").single();
  if (saved.error) console.error("save question failed:", saved.error.message);

  return reply({
    ok: true,
    kind: "answer",
    answer: outcome.answer,
    checkQuestion: outcome.checkQuestion,
    fallback: outcome.fallback !== null,
    questionId: (saved.data?.id as string | undefined) ?? null,
  });
}
