import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { llmConfigured, llmGenerate, llmProvider } from "@/lib/llm";
import type { Lesson } from "@/lib/lesson/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { assembleLesson, authorPayload, authorSystemPrompt, parseAuthorAnswer, type SourceMaterial } from "./author";
import { buildContext, profileUsed, ProfileInputSchema, SAMPLE_PROFILES, skillsFor, type OutcomeInput, type ProfileInput } from "./context";
import { codeScores, combine, criticPayload, criticSystemPrompt, feedbackFor, parseCriticAnswer, type CriticResult } from "./critic";
import { RUBRIC_S } from "./pedagogy";
import { planLesson, type Plan } from "./planner";
import { checkLessonMath, type MathFailure } from "./validate";

/**
 * Lesson generation pipeline (CLAUDE.md §7.9):
 * plan (D1–D8, Rubric T) → author (approved materials only) → math gate →
 * critic (Rubric S) → deliver (≥ 75, gates pass) / regenerate (max 2) / teacher review.
 * Writes with the service role; callers check who may trigger it.
 */

export type Target = { kind: "learner"; learnerId: string } | { kind: "sample"; sampleId: string };

const DELIVERABLE = ["delivered", "approved"] as const;

const OutcomeRow = z.object({
  code: z.string(),
  description_en: z.string(),
  knowledge_type: z.enum(["procedural", "conceptual"]).nullable(),
  bloom_level: z.string().nullable(),
  prerequisites: z.array(z.string()).nullable(),
  indicators: z.array(z.object({ code: z.string(), description: z.string() })),
  misconceptions: z.array(z.object({ code: z.string(), description: z.string() })),
});

async function loadOutcome(code: string): Promise<OutcomeInput | null> {
  const { data } = await createAdminClient()
    .from("outcomes")
    .select("code, description_en, knowledge_type, bloom_level, prerequisites, indicators(code, description), misconceptions(code, description)")
    .eq("code", code)
    .maybeSingle();
  const p = OutcomeRow.safeParse(data);
  if (!p.success) return null;
  return {
    code: p.data.code,
    description: p.data.description_en,
    knowledgeType: p.data.knowledge_type,
    bloom: p.data.bloom_level,
    indicators: p.data.indicators,
    misconceptions: p.data.misconceptions,
    prerequisites: p.data.prerequisites ?? [],
  };
}

/** Approved materials for an outcome (only these feed generation, §7.7). */
export async function approvedMaterials(code: string): Promise<SourceMaterial[]> {
  const { data } = await createAdminClient()
    .from("materials")
    .select("id, title, source_url, licence, extracted_text")
    .eq("status", "approved")
    .contains("outcome_codes", [code])
    .order("score", { ascending: false })
    .limit(3);
  return (data ?? [])
    .filter((m) => (m.extracted_text as string | null)?.trim())
    .map((m, i) => ({
      ref: `m${i + 1}`,
      id: m.id as string,
      title: m.title as string,
      sourceUrl: (m.source_url as string | null) ?? null,
      licence: m.licence as string,
      excerpt: (m.extracted_text as string).slice(0, 4000),
    }));
}

async function loadProfile(target: Target): Promise<ProfileInput | null> {
  if (target.kind === "sample") return SAMPLE_PROFILES[target.sampleId]?.profile ?? null;
  const { data } = await createAdminClient()
    .from("learner_profiles")
    .select("mastery, misconceptions, reading_level, interests, confidence, learning_rate")
    .eq("learner_id", target.learnerId)
    .maybeSingle();
  if (!data) return null;
  return ProfileInputSchema.parse(data);
}

/** Pseudonymous id shown to teachers instead of the learner (CLAUDE.md §2). */
export function pseudonymFor(learnerId: string): string {
  return `L-${createHash("sha256").update(`sesame-learner:${learnerId}`).digest("hex").slice(0, 6)}`;
}

export type AttemptLog = { attempt: number; total: number | null; failedGates: string[]; math: MathFailure[]; problems: string[]; error?: string };

/** Inserts the lessons row in status "generating" (so a second trigger sees it). Returns the id. */
export async function startLesson(outcomeCode: string, target: Target, requestedBy: string | null = null): Promise<string> {
  const admin = createAdminClient();
  const id = `gen-${randomUUID()}`;
  const insert = await admin.from("lessons").insert({
    id,
    outcome_code: outcomeCode,
    learner_id: target.kind === "learner" ? target.learnerId : null,
    sample_profile: target.kind === "sample" ? target.sampleId : null,
    pseudonym: target.kind === "learner" ? pseudonymFor(target.learnerId) : `Sample ${target.sampleId}`,
    status: "generating",
    requested_by: requestedBy,
  });
  if (insert.error) throw new Error(`start lesson: ${insert.error.message}`);
  return id;
}

/** Starts a lessons row and runs the whole pipeline. Returns the lesson id. */
export async function generateLesson(outcomeCode: string, target: Target, requestedBy: string | null = null): Promise<string> {
  const id = await startLesson(outcomeCode, target, requestedBy);
  await runPipeline(id, outcomeCode, target, []);
  return id;
}

/** Runs (or re-runs, for a teacher's "revise") the pipeline for an existing lessons row. */
export async function runPipeline(id: string, outcomeCode: string, target: Target, teacherNotes: string[]): Promise<void> {
  const admin = createAdminClient();
  const fail = async (error: string) => {
    await admin.from("lessons").update({ status: "failed", error, updated_at: new Date().toISOString() }).eq("id", id);
  };

  try {
    const [lo, profile, materials] = await Promise.all([loadOutcome(outcomeCode), loadProfile(target), approvedMaterials(outcomeCode)]);
    if (!lo) return fail("Outcome not found.");
    if (!profile) return fail("No learner profile to plan for.");
    if (!lo.misconceptions.length) return fail("Add at least one misconception to this outcome: exit-ticket distractors must map to misconceptions (§7.1).");
    if (!materials.length) return fail("No approved materials with readable text for this outcome. Only approved materials feed lesson generation (§7.7).");
    if (!llmConfigured()) return fail("AI not connected yet.");

    const ctx = buildContext(lo, profile);
    const plan = planLesson(ctx);
    const input = {
      plan,
      ctx,
      materials,
      skills: skillsFor(lo.code, profile),
      learner: { readingLevel: profile.reading_level ?? "grade 6", interests: profile.interests },
      feedback: teacherNotes.map((n) => `Teacher note: ${n}`),
    };

    const attempts: AttemptLog[] = [];
    let best: { lesson: Lesson; critic: CriticResult; math: MathFailure[] } | null = null;
    let final: CriticResult["decision"] = "review";
    const maxAttempts = RUBRIC_S.max_regenerations + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const authored = await llmGenerate({ system: authorSystemPrompt(), user: authorPayload(input), maxTokens: 8000, json: true, timeoutMs: 240_000 });
      if (!authored.ok) {
        attempts.push({ attempt, total: null, failedGates: [], math: [], problems: [], error: authored.error });
        if (attempt === maxAttempts) break;
        continue;
      }
      const parsed = parseAuthorAnswer(authored.text);
      const assembled = parsed.ok ? assembleLesson(id, input, parsed.value) : parsed;
      if (!assembled.ok) {
        attempts.push({ attempt, total: null, failedGates: [], math: [], problems: [], error: assembled.error });
        input.feedback = [...teacherNotes.map((n) => `Teacher note: ${n}`), assembled.error];
        continue;
      }
      const math = checkLessonMath(assembled.lesson);
      const code = codeScores(assembled.lesson, plan, ctx, math);
      const judged = await llmGenerate({ system: criticSystemPrompt(), user: criticPayload(assembled.lesson, ctx), maxTokens: 1200, json: true, timeoutMs: 60_000 });
      const critic = combine(code, judged.ok ? parseCriticAnswer(judged.text) : null, attempt);
      attempts.push({ attempt, total: critic.total, failedGates: critic.failedGates, math, problems: assembled.problems });
      if (!best || critic.total > best.critic.total || (best.critic.failedGates.length && !critic.failedGates.length)) {
        best = { lesson: assembled.lesson, critic, math };
      }
      if (critic.decision === "deliver") {
        best = { lesson: assembled.lesson, critic, math };
        final = "deliver";
        break;
      }
      if (critic.decision === "review") {
        final = "review";
        break;
      }
      input.feedback = [...teacherNotes.map((n) => `Teacher note: ${n}`), ...feedbackFor(critic, math, assembled.problems)];
    }

    if (!best) {
      await admin
        .from("lessons")
        .update({ status: "failed", attempts: attempts.length, error: attempts.at(-1)?.error ?? "The author did not produce a usable lesson.", rationale: { attempts }, updated_at: new Date().toISOString() })
        .eq("id", id);
      return;
    }
    // A math failure always blocks delivery, whatever the total (§7.9).
    const status = final === "deliver" && best.math.length === 0 ? "delivered" : "review";
    await admin
      .from("lessons")
      .update({
        status,
        lesson: best.lesson,
        rationale: rationaleCard(plan, materials, best.lesson, attempts),
        rubric_s: best.critic,
        fit_score: best.critic.total,
        attempts: attempts.length,
        profile_used: profileUsed(ctx, profile),
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch (err) {
    await fail(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The "why this lesson" card: rules applied, method per activity with scores and citations, sources used. */
function rationaleCard(plan: Plan, materials: SourceMaterial[], lesson: Lesson, attempts: AttemptLog[]) {
  const used = new Set(lesson.slides.flatMap((s) => s.sources ?? []));
  return {
    provider: llmProvider(),
    flags: plan.flags,
    pace: plan.pace.level,
    rules_applied: plan.rulesApplied,
    excluded: plan.excluded,
    activities: plan.activities,
    review_after_days: plan.reviewAfterDays,
    needs_diagnostic: plan.needsDiagnostic,
    sources: materials.filter((m) => used.has(m.id)).map((m) => ({ id: m.id, title: m.title, source_url: m.sourceUrl, licence: m.licence })),
    attempts,
  };
}

const LessonRow = z.object({ id: z.string(), lesson: z.unknown(), status: z.string() });

/** The newest generated lesson a learner may play for this outcome, if any. */
export async function deliverableLesson(learnerId: string, outcomeCode: string): Promise<{ id: string; lesson: unknown } | null> {
  const { data } = await createAdminClient()
    .from("lessons")
    .select("id, lesson, status")
    .eq("learner_id", learnerId)
    .eq("outcome_code", outcomeCode)
    .in("status", [...DELIVERABLE])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = LessonRow.safeParse(data);
  return p.success ? { id: p.data.id, lesson: p.data.lesson } : null;
}

/** A learner's own generated lesson by id, only when it may be played. */
export async function deliverableById(learnerId: string, lessonId: string): Promise<unknown | null> {
  if (!lessonId.startsWith("gen-")) return null;
  const { data } = await createAdminClient()
    .from("lessons")
    .select("lesson")
    .eq("id", lessonId)
    .eq("learner_id", learnerId)
    .in("status", [...DELIVERABLE])
    .maybeSingle();
  return data?.lesson ?? null;
}

/**
 * Automatic generation for a real learner (owner decision, Round 10): when the
 * target outcome has approved materials and the learner has no lesson in
 * progress, delivered, approved or waiting for review. Returns true if started.
 */
export async function shouldGenerateFor(learnerId: string, outcomeCode: string): Promise<boolean> {
  const admin = createAdminClient();
  const [{ count: open }, materials] = await Promise.all([
    admin
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("learner_id", learnerId)
      .eq("outcome_code", outcomeCode)
      .in("status", ["generating", "delivered", "review", "approved"]),
    admin.from("materials").select("id", { count: "exact", head: true }).eq("status", "approved").contains("outcome_codes", [outcomeCode]),
  ]);
  return (open ?? 0) === 0 && (materials.count ?? 0) > 0 && llmConfigured();
}

export async function isGenerating(learnerId: string, outcomeCode: string): Promise<boolean> {
  const { count } = await createAdminClient()
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("learner_id", learnerId)
    .eq("outcome_code", outcomeCode)
    .eq("status", "generating");
  return (count ?? 0) > 0;
}
