import { z } from "zod";
import demoA from "@/content/profiles/demo-A.json";
import sampleFast from "@/content/profiles/sample-fast.json";
import sampleSlow from "@/content/profiles/sample-slow.json";
import { readiness } from "@/lib/learner/bkt";
import type { LearningRateLevel } from "@/lib/learner/bkt";
import type { PlanContext } from "./planner";

/**
 * Builds the planner's view of an outcome and a learner. Pure. The same code
 * serves real learners (learner_profiles row) and the synthetic sample
 * profiles teachers use for previews (content/profiles/*.json).
 */

export const ProfileInputSchema = z.object({
  mastery: z.record(z.string(), z.coerce.number()).catch({}),
  misconceptions: z.array(z.string()).catch([]),
  reading_level: z.string().nullable().catch(null),
  interests: z.array(z.string()).catch([]),
  confidence: z.coerce.number().catch(0),
  learning_rate: z.object({ level: z.enum(["slow", "medium", "fast"]) }).nullable().catch(null),
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

const fromSample = (raw: { mastery: Record<string, number>; misconceptions: string[]; reading_level: string; interests: string[]; confidence_of_estimate: number; learning_rate?: { level: string } }) =>
  ProfileInputSchema.parse({ ...raw, confidence: raw.confidence_of_estimate, learning_rate: raw.learning_rate ?? null });

export const SAMPLE_PROFILES: Record<string, { label: string; profile: ProfileInput }> = {
  "demo-A": { label: "Demo A: medium pace, weak on two-step and brackets (M2, M3)", profile: fromSample(demoA) },
  "sample-fast": { label: "Fast learner: strong on 8PR2, no known mistakes", profile: fromSample(sampleFast) },
  "sample-slow": { label: "Slow pace: low readiness, high math anxiety (M1, M5)", profile: fromSample(sampleSlow) },
};

export type OutcomeInput = {
  code: string;
  description: string;
  knowledgeType: "procedural" | "conceptual" | null;
  bloom: string | null;
  indicators: { code: string; description: string }[];
  misconceptions: { code: string; description: string }[];
  prerequisites: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mastery of one prerequisite: a skill id, or the mean of an outcome's skills. */
function masteryOf(key: string, mastery: Record<string, number>): number {
  return readiness([key], mastery) ?? 0;
}

/** Skill ids the lesson's items update: the learner's known skills for this LO, else "<LO>.core". */
export function skillsFor(code: string, profile: ProfileInput): string[] {
  const known = Object.keys(profile.mastery).filter((k) => k.startsWith(`${code}.`));
  return known.length ? known : [`${code}.core`];
}

export function buildContext(lo: OutcomeInput, profile: ProfileInput): PlanContext {
  const own = Object.entries(profile.mastery).filter(([k]) => k.startsWith(`${lo.code}.`));
  const loMastery = own.length ? round2(own.reduce((s, [, v]) => s + v, 0) / own.length) : 0;
  const prerequisiteMastery = Object.fromEntries(lo.prerequisites.map((p) => [p, round2(masteryOf(p, profile.mastery))]));
  const loMis = new Set(lo.misconceptions.map((m) => m.code));
  const pace: LearningRateLevel = profile.learning_rate?.level ?? "medium";
  return {
    lo,
    learner: {
      readiness: readiness(lo.prerequisites, profile.mastery),
      loMastery,
      misconceptions: profile.misconceptions.filter((m) => loMis.has(m)),
      pace,
      prerequisiteMastery,
      confidence: profile.confidence,
    },
  };
}

/** Only the profile fields the lesson used: what a reviewing teacher may see (CLAUDE.md §2). */
export function profileUsed(ctx: PlanContext, profile: ProfileInput) {
  return {
    readiness: ctx.learner.readiness,
    lo_mastery: ctx.learner.loMastery,
    prerequisite_mastery: ctx.learner.prerequisiteMastery,
    misconceptions: ctx.learner.misconceptions,
    pace: ctx.learner.pace,
    confidence: ctx.learner.confidence,
    reading_level: profile.reading_level ?? "grade 6",
    interests: profile.interests,
  };
}
