import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Curriculum and learner context for a question. Works with a user or admin client. */
export async function loadAskContext(db: SupabaseClient, learnerId: string, outcomeCode: string) {
  const [outcome, indicators, misconceptions, profile] = await Promise.all([
    db.from("outcomes").select("code, description_en").eq("code", outcomeCode).maybeSingle(),
    db.from("indicators").select("code, description").eq("outcome_code", outcomeCode).order("code"),
    db.from("misconceptions").select("code, description").eq("outcome_code", outcomeCode).order("code"),
    db.from("learner_profiles").select("reading_level, interests, misconceptions").eq("learner_id", learnerId).maybeSingle(),
  ]);

  const Code = z.array(z.object({ code: z.string(), description: z.string() }));
  const Profile = z.object({
    reading_level: z.string().nullable(),
    interests: z.array(z.string()),
    misconceptions: z.array(z.string()),
  });
  const o = z.object({ code: z.string(), description_en: z.string() }).safeParse(outcome.data);
  const p = Profile.safeParse(profile.data);

  return {
    outcome: o.success ? { code: o.data.code, description: o.data.description_en } : { code: outcomeCode, description: "" },
    indicators: Code.safeParse(indicators.data).data ?? [],
    misconceptions: Code.safeParse(misconceptions.data).data ?? [],
    learner: p.success ? p.data : { reading_level: "grade 6", interests: [], misconceptions: [] },
  };
}
