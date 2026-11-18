import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { OutcomeStatusKind } from "@/lib/learner-profile";
import { requireRole } from "@/lib/auth/dal";

const StrandRow = z.object({
  code: z.string(),
  name_en: z.string(),
  name_vi: z.string(),
  sort_order: z.number(),
});

const OutcomeRow = z.object({
  code: z.string(),
  strand: z.string(),
  sort_order: z.number(),
  description_en: z.string(),
  description_vi: z.string(),
  parent_friendly: z.string(),
});

export type Outcome = z.infer<typeof OutcomeRow>;
export type StrandWithOutcomes = z.infer<typeof StrandRow> & { outcomes: Outcome[] };

/** All strands in order, each with its outcomes in order. Requires a signed-in user (RLS). */
export async function getCurriculum(): Promise<StrandWithOutcomes[]> {
  const supabase = await createClient();
  const [strands, outcomes] = await Promise.all([
    supabase.from("strands").select("code, name_en, name_vi, sort_order").order("sort_order"),
    supabase
      .from("outcomes")
      .select("code, strand, sort_order, description_en, description_vi, parent_friendly")
      .order("sort_order"),
  ]);
  const s = z.array(StrandRow).safeParse(strands.data);
  const o = z.array(OutcomeRow).safeParse(outcomes.data);
  if (!s.success || !o.success) return [];
  return s.data.map((strand) => ({ ...strand, outcomes: o.data.filter((x) => x.strand === strand.code) }));
}

const StatusRow = z.object({
  outcome_code: z.string(),
  status: z.enum(["not_started", "learning", "nearly", "achieved", "retained"]),
});

/** The signed-in learner's own outcome status, keyed by outcome code. */
export async function getMyOutcomeStatus(): Promise<Record<string, OutcomeStatusKind>> {
  await requireRole("learner");
  const supabase = await createClient();
  const { data } = await supabase.from("outcome_status").select("outcome_code, status");
  const parsed = z.array(StatusRow).safeParse(data);
  if (!parsed.success) return {};
  return Object.fromEntries(parsed.data.map((r) => [r.outcome_code, r.status]));
}

/** The signed-in learner's target outcome from their profile, if any. */
export async function getMyTargetOutcome(): Promise<string | null> {
  const user = await requireRole("learner");
  const supabase = await createClient();
  const { data } = await supabase
    .from("learner_profiles")
    .select("target_outcome")
    .eq("learner_id", user.id)
    .maybeSingle();
  const parsed = z.object({ target_outcome: z.string().nullable() }).safeParse(data);
  return parsed.success ? parsed.data.target_outcome : null;
}
