import { z } from "zod";

/**
 * Learner profile contract with the future Assessment Agent (CLAUDE.md §9).
 * This file only imports zod so seed scripts can use it directly with Node.
 */
export const LearnerProfileSchema = z.object({
  learner_id: z.string().min(1),
  grade: z.number().int().min(1).max(12),
  school_context: z.string(),
  target_outcome: z.string().regex(/^8(N|PR|SS|SP)\d+$/),
  mastery: z.record(z.string().regex(/^8(N|PR|SS|SP)\d+\.[a-z_]+$/), z.number().min(0).max(1)),
  misconceptions: z.array(z.string().regex(/^M\d+$/)),
  affect: z.object({
    math_anxiety: z.enum(["low", "moderate", "high"]),
    confidence_self_report: z.number().int().min(1).max(5),
  }),
  reading_level: z.string(),
  language: z.object({ primary: z.string(), ell: z.boolean() }),
  accessibility: z.array(z.string()),
  interests: z.array(z.string()),
  evidence: z.array(z.string()),
  confidence_of_estimate: z.number().min(0).max(1),
});

export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

/** Below this, the lesson starts with 3–4 short diagnostic questions (§9). */
export const DIAGNOSTIC_CONFIDENCE_THRESHOLD = 0.6;

export function needsDiagnostic(profile: Pick<LearnerProfile, "confidence_of_estimate">): boolean {
  return profile.confidence_of_estimate < DIAGNOSTIC_CONFIDENCE_THRESHOLD;
}

export type OutcomeStatusKind = "not_started" | "learning" | "nearly" | "achieved" | "retained";

/**
 * Status from a mastery estimate (CLAUDE.md §6): learning < 0.60,
 * nearly 0.60–0.79, achieved >= 0.80. "retained" needs a second check
 * >= 14 days later, so it is never derived from one number.
 */
export function statusForMastery(mastery: number | null | undefined): OutcomeStatusKind {
  if (mastery == null) return "not_started";
  if (mastery >= 0.8) return "achieved";
  if (mastery >= 0.6) return "nearly";
  return "learning";
}

/** Averages sub-skill mastery ("8PR2.two_step") per outcome code ("8PR2"). */
export function outcomeMastery(mastery: LearnerProfile["mastery"]): Record<string, number> {
  const groups: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(mastery)) {
    const outcome = key.split(".")[0];
    (groups[outcome] ??= []).push(value);
  }
  return Object.fromEntries(
    Object.entries(groups).map(([code, values]) => [
      code,
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
    ]),
  );
}

/** Maps a §9 profile to a learner_profiles row (learner_id becomes the account's uuid). */
export function toLearnerProfileRow(profile: LearnerProfile, learnerUuid: string) {
  return {
    learner_id: learnerUuid,
    grade: profile.grade,
    school_context: profile.school_context,
    target_outcome: profile.target_outcome,
    mastery: profile.mastery,
    misconceptions: profile.misconceptions,
    affect: profile.affect,
    reading_level: profile.reading_level,
    language: profile.language,
    accessibility: profile.accessibility,
    interests: profile.interests,
    evidence: profile.evidence,
    confidence: profile.confidence_of_estimate,
    updated_at: new Date().toISOString(),
  };
}
