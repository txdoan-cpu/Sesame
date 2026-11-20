import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAnswers } from "@/lib/learner/model";
import { evaluateRewardsForLearner } from "@/lib/rewards-service";
import type { OutcomeStatusKind } from "@/lib/learner-profile";
import type { Lesson } from "./schema";
import { nextOutcomeStatus, scoreExitTicket, updateMisconceptions, type ExitAnswers, type ExitScore } from "./scoring";

const PrevStatusRow = z.object({
  status: z.enum(["not_started", "learning", "nearly", "achieved", "retained"]),
  achieved_at: z.string().nullable(),
  retained_at: z.string().nullable(),
});

const ProfileRow = z.object({ misconceptions: z.array(z.string()) });

export type SavedExit = ExitScore & { status: OutcomeStatusKind };

/**
 * Scores an exit ticket on the server and writes assessments, outcome_status
 * and learner_profiles.misconceptions; each item also updates the learner
 * model (BKT, §7.8), which recomputes learner_profiles.mastery. Caller must have checked
 * that `learnerId` is the signed-in learner.
 */
export async function saveExitTicket(
  learnerId: string,
  lesson: Lesson,
  answers: ExitAnswers,
  now: Date = new Date(),
  /** "retention": the same check taken again later, for rewards (§7.4) and "retained" (§6). */
  kind: "exit" | "retention" = "exit",
): Promise<SavedExit> {
  const admin = createAdminClient();
  const result = scoreExitTicket(lesson, answers);

  const [prevRes, profileRes] = await Promise.all([
    admin
      .from("outcome_status")
      .select("status, achieved_at, retained_at")
      .eq("learner_id", learnerId)
      .eq("outcome_code", lesson.outcome_code)
      .maybeSingle(),
    admin.from("learner_profiles").select("misconceptions").eq("learner_id", learnerId).maybeSingle(),
  ]);
  if (prevRes.error) throw new Error(`read outcome_status: ${prevRes.error.message}`);
  if (profileRes.error) throw new Error(`read learner_profiles: ${profileRes.error.message}`);

  const prev = prevRes.data ? PrevStatusRow.parse(prevRes.data) : null;
  const profile = profileRes.data ? ProfileRow.parse(profileRes.data) : { misconceptions: [] };
  const next = nextOutcomeStatus(prev, result, now);
  const misconceptions = updateMisconceptions(lesson, profile.misconceptions, result);
  const nowIso = now.toISOString();

  const insert = await admin.from("assessments").insert({
    learner_id: learnerId,
    outcome_code: lesson.outcome_code,
    lesson_id: lesson.id,
    kind,
    score: result.score,
    taken_at: nowIso,
    item_results: {
      items: result.items,
      explained_balance: result.explainedBalance,
      explanation: answers.explanation.trim().slice(0, 500),
      mastered: result.mastered,
    },
  });
  if (insert.error) throw new Error(`insert assessment: ${insert.error.message}`);

  const status = await admin.from("outcome_status").upsert(
    {
      learner_id: learnerId,
      outcome_code: lesson.outcome_code,
      status: next.status,
      mastery: next.mastery,
      achieved_at: next.achieved_at,
      retained_at: next.retained_at,
      updated_at: nowIso,
    },
    { onConflict: "learner_id,outcome_code" },
  );
  if (status.error) throw new Error(`upsert outcome_status: ${status.error.message}`);

  const prof = await admin.from("learner_profiles").upsert(
    { learner_id: learnerId, misconceptions, updated_at: nowIso },
    { onConflict: "learner_id" },
  );
  if (prof.error) throw new Error(`upsert learner_profiles: ${prof.error.message}`);

  // §7.8: every scored exit-ticket item updates knowledge_state; the profile's mastery follows.
  await recordAnswers(
    learnerId,
    result.items.map((i) => ({ skill: i.skill, correct: i.correct, source: kind, lessonId: lesson.id, itemId: i.item })),
    now,
  );

  // Milestones, unlocks and expiry follow straight from the new result.
  try {
    await evaluateRewardsForLearner(learnerId, now);
  } catch (err) {
    console.error("reward evaluation failed:", err instanceof Error ? err.message : err);
  }

  return { ...result, status: next.status };
}
