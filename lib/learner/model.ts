import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_PARAMS,
  LEARNER_MODEL,
  bktUpdate,
  confidenceOfEstimate,
  estimateTransit,
  itemsToMastery,
  learningRateLevel,
  readiness,
  replay,
  type BktParams,
  type LearningRateLevel,
} from "./bkt";

/**
 * Automatic learner model (CLAUDE.md §7.8). Every scored answer updates
 * knowledge_state with BKT; every 20 answers the learner's own learning rate
 * (p_transit) is re-estimated; learner_profiles (mastery, readiness,
 * learning_rate, confidence) is recomputed after each batch of answers.
 * Server only: writes with the service role after the caller checked the learner.
 */

export type AnswerSource = "checkpoint" | "diagnostic" | "exit" | "retention";
export type ScoredAnswer = { skill: string; correct: boolean; source: AnswerSource; lessonId?: string; itemId?: string };

export const LearningRateSchema = z.object({
  level: z.enum(["slow", "medium", "fast"]),
  p_transit: z.number(),
  items_to_mastery_avg: z.number().nullable().optional(),
  estimated_at_answers: z.number().int().optional(),
  estimated_at: z.string().optional(),
});
export type LearningRate = z.infer<typeof LearningRateSchema>;

const StateRow = z.object({
  skill_id: z.string(),
  p_init: z.coerce.number(),
  p_mastery: z.coerce.number(),
  p_transit: z.coerce.number(),
  p_slip: z.coerce.number(),
  p_guess: z.coerce.number(),
  attempts: z.number().int(),
  correct: z.number().int(),
});
type State = z.infer<typeof StateRow>;

const ProfileRow = z.object({
  mastery: z.record(z.string(), z.coerce.number()).catch({}),
  learning_rate: z.unknown(),
  confidence: z.coerce.number().catch(0),
  target_outcome: z.string().nullable(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function learnerRate(raw: unknown): LearningRate | null {
  const p = LearningRateSchema.safeParse(raw);
  return p.success ? p.data : null;
}

async function loadProfile(learnerId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("learner_profiles")
    .select("mastery, learning_rate, confidence, target_outcome")
    .eq("learner_id", learnerId)
    .maybeSingle();
  const p = ProfileRow.safeParse(data ?? {});
  return p.success ? p.data : { mastery: {}, learning_rate: {}, confidence: 0, target_outcome: null };
}

async function loadStates(learnerId: string): Promise<Map<string, State>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("knowledge_state")
    .select("skill_id, p_init, p_mastery, p_transit, p_slip, p_guess, attempts, correct")
    .eq("learner_id", learnerId);
  return new Map(z.array(StateRow).parse(data ?? []).map((s) => [s.skill_id, s]));
}

async function countAnswers(learnerId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin.from("skill_answers").select("id", { count: "exact", head: true }).eq("learner_id", learnerId);
  return count ?? 0;
}

const params = (s: State): BktParams => ({ pTransit: s.p_transit, pSlip: s.p_slip, pGuess: s.p_guess });

export type ModelUpdate = { answers: number; reestimated: boolean; level: LearningRateLevel; pTransit: number };

/** Prerequisites of every outcome that has some (a handful of rows), for readiness. */
async function loadPrerequisites(): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const { data } = await admin.from("outcomes").select("code, prerequisites").neq("prerequisites", "{}");
  return new Map((data ?? []).map((o) => [o.code as string, (o.prerequisites as string[] | null) ?? []]));
}

type Snapshot = {
  profile: Awaited<ReturnType<typeof loadProfile>>;
  states: Map<string, State>;
  total: number;
  prerequisites: Map<string, string[]>;
};

async function loadSnapshot(learnerId: string): Promise<Snapshot> {
  const [profile, states, total, prerequisites] = await Promise.all([
    loadProfile(learnerId),
    loadStates(learnerId),
    countAnswers(learnerId),
    loadPrerequisites(),
  ]);
  return { profile, states, total, prerequisites };
}

/** learner_profiles from knowledge_state: mastery, readiness, learning_rate, confidence (§7.8). */
async function saveProfile(learnerId: string, snap: Snapshot, rate: LearningRate, now: Date): Promise<void> {
  const mastery = { ...snap.profile.mastery };
  for (const s of snap.states.values()) mastery[s.skill_id] = round2(s.p_mastery);
  const prereqs = snap.profile.target_outcome ? (snap.prerequisites.get(snap.profile.target_outcome) ?? []) : [];
  const up = await createAdminClient()
    .from("learner_profiles")
    .upsert(
      {
        learner_id: learnerId,
        mastery,
        readiness: readiness(prereqs, mastery),
        learning_rate: rate,
        confidence: confidenceOfEstimate(snap.profile.confidence, snap.total),
        updated_at: now.toISOString(),
      },
      { onConflict: "learner_id" },
    );
  if (up.error) throw new Error(`save learner_profiles: ${up.error.message}`);
}

const defaultRate = (): LearningRate => ({ level: learningRateLevel(DEFAULT_PARAMS.pTransit), p_transit: DEFAULT_PARAMS.pTransit });

/** Records scored answers in order and updates the learner model. */
export async function recordAnswers(learnerId: string, answers: readonly ScoredAnswer[], now: Date = new Date()): Promise<ModelUpdate> {
  const admin = createAdminClient();
  const snap = await loadSnapshot(learnerId);
  const { profile, states } = snap;
  let rate = learnerRate(profile.learning_rate) ?? defaultRate();
  const nowIso = now.toISOString();

  const touched = new Set<string>();
  for (const a of answers) {
    let s = states.get(a.skill);
    if (!s) {
      // p_init from the diagnostic (the profile's estimate for this skill), else the default.
      const pInit = profile.mastery[a.skill] ?? LEARNER_MODEL.bkt_defaults.p_init;
      s = { skill_id: a.skill, p_init: pInit, p_mastery: pInit, p_transit: rate.p_transit, p_slip: DEFAULT_PARAMS.pSlip, p_guess: DEFAULT_PARAMS.pGuess, attempts: 0, correct: 0 };
      states.set(a.skill, s);
    }
    s.p_mastery = round4(bktUpdate(s.p_mastery, a.correct, params(s)));
    s.attempts += 1;
    if (a.correct) s.correct += 1;
    touched.add(a.skill);
  }

  if (answers.length) {
    const [ins, up] = await Promise.all([
      admin.from("skill_answers").insert(
        answers.map((a) => ({
          learner_id: learnerId,
          skill_id: a.skill,
          correct: a.correct,
          source: a.source,
          lesson_id: a.lessonId ?? null,
          item_id: a.itemId ?? null,
          created_at: nowIso,
        })),
      ),
      admin
        .from("knowledge_state")
        .upsert([...touched].map((k) => ({ ...states.get(k)!, learner_id: learnerId, updated_at: nowIso })), { onConflict: "learner_id,skill_id" }),
    ]);
    if (ins.error) throw new Error(`insert skill_answers: ${ins.error.message}`);
    if (up.error) throw new Error(`upsert knowledge_state: ${up.error.message}`);
  }

  const before = snap.total;
  snap.total = before + answers.length;
  const every = LEARNER_MODEL.reestimate_every_answers;
  const reestimated = Math.floor(snap.total / every) > Math.floor(before / every);
  if (reestimated) rate = (await reestimate(learnerId, snap, now)) ?? rate;

  await saveProfile(learnerId, snap, rate, now);
  return { answers: snap.total, reestimated, level: rate.level, pTransit: rate.p_transit };
}

/**
 * Individualized BKT: fits the learner's p_transit to all their answers, then
 * replays every skill with it so p_mastery matches the new rate. Updates the
 * snapshot's states in place.
 */
async function reestimate(learnerId: string, snap: Snapshot, now: Date): Promise<LearningRate | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("skill_answers").select("skill_id, correct").eq("learner_id", learnerId).order("id").limit(10_000);
  const bySkill = new Map<string, boolean[]>();
  for (const r of data ?? []) {
    const list = bySkill.get(r.skill_id as string) ?? [];
    list.push(Boolean(r.correct));
    bySkill.set(r.skill_id as string, list);
  }
  const sequences = [...bySkill].map(([skill, answers]) => ({ pInit: snap.states.get(skill)?.p_init ?? LEARNER_MODEL.bkt_defaults.p_init, answers }));
  const t = estimateTransit(sequences);
  if (t === null) return null;

  const nowIso = now.toISOString();
  for (const s of snap.states.values()) {
    s.p_transit = t;
    s.p_mastery = round4(replay(s.p_init, bySkill.get(s.skill_id) ?? [], { pTransit: t, pSlip: s.p_slip, pGuess: s.p_guess }));
  }
  const rows = [...snap.states.values()].map((s) => ({ ...s, learner_id: learnerId, updated_at: nowIso }));
  if (rows.length) {
    const up = await admin.from("knowledge_state").upsert(rows, { onConflict: "learner_id,skill_id" });
    if (up.error) throw new Error(`re-estimate knowledge_state: ${up.error.message}`);
  }
  const steps = rows.map((s) => itemsToMastery(s.p_init, t)).filter(Number.isFinite);
  return {
    level: learningRateLevel(t),
    p_transit: t,
    items_to_mastery_avg: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
    estimated_at_answers: snap.total,
    estimated_at: nowIso,
  };
}

/** Recomputes learner_profiles from knowledge_state (called when a session ends, §7.8). */
export async function refreshProfile(learnerId: string, now: Date = new Date()): Promise<void> {
  const snap = await loadSnapshot(learnerId);
  await saveProfile(learnerId, snap, learnerRate(snap.profile.learning_rate) ?? defaultRate(), now);
}

/** The pace level for the lesson player (default p_transit 0.2 → medium). Reads with the learner's own session. */
export function levelFromProfile(raw: unknown): LearningRateLevel {
  return learnerRate(raw)?.level ?? learningRateLevel(DEFAULT_PARAMS.pTransit);
}
