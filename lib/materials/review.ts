import "server-only";
import { z } from "zod";
import { llmConfigured, llmGenerate, llmProvider } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRubricAnswer, rubricPayload, rubricSystemPrompt, scoreRubric, type RubricResult } from "./rubric";

/**
 * Scores a material against Rubric R with the LLM and stores the result
 * (CLAUDE.md §7.7). Gate failures or a weighted mean below 2.0 → rejected
 * with reasons; otherwise approved. If the model is not available the
 * material stays "pending" and can be scored again later.
 */

export type StoredRubric = RubricResult & { provider: string; model: string; scoredAt: string; note: string | null };

const MaterialForReview = z.object({
  id: z.string(),
  title: z.string(),
  source_url: z.string().nullable(),
  licence: z.string(),
  licence_note: z.string().nullable(),
  extracted_text: z.string().nullable(),
  outcome_codes: z.array(z.string()),
  status: z.string(),
  override_reason: z.string().nullable(),
});

export async function reviewMaterial(materialId: string, extractionNote: string | null = null): Promise<{ status: string; error?: string }> {
  const admin = createAdminClient();
  const m = MaterialForReview.safeParse(
    (
      await admin
        .from("materials")
        .select("id, title, source_url, licence, licence_note, extracted_text, outcome_codes, status, override_reason")
        .eq("id", materialId)
        .maybeSingle()
    ).data,
  );
  if (!m.success) return { status: "pending", error: "not_found" };
  const material = m.data;

  const pending = async (error: string) => {
    await admin
      .from("materials")
      .update({ status: "pending", rubric_r: { error, note: extractionNote }, updated_at: new Date().toISOString() })
      .eq("id", materialId);
    return { status: "pending", error };
  };

  if (!material.extracted_text?.trim()) return pending(extractionNote ?? "No text could be read from this material.");
  if (!llmConfigured()) return pending("AI not connected yet.");

  const { data: outcomes } = await admin
    .from("outcomes")
    .select("code, description_en, bloom_level, knowledge_type, prerequisites")
    .in("code", material.outcome_codes);

  const r = await llmGenerate({
    system: rubricSystemPrompt(),
    user: rubricPayload({
      material: {
        title: material.title,
        sourceUrl: material.source_url,
        licence: material.licence,
        licenceNote: material.licence_note,
        text: material.extracted_text,
      },
      outcomes: (outcomes ?? []).map((o) => ({
        code: o.code as string,
        description: o.description_en as string,
        bloomLevel: (o.bloom_level as string | null) ?? null,
        knowledgeType: (o.knowledge_type as string | null) ?? null,
        prerequisites: (o.prerequisites as string[]) ?? [],
      })),
    }),
    maxTokens: 900,
    json: true,
    timeoutMs: 45_000,
  });
  if (!r.ok) return pending(`Scoring failed: ${r.error}`);
  const answer = parseRubricAnswer(r.text);
  if (!answer) return pending("The reviewer's answer could not be read. Try scoring again.");

  const result = scoreRubric(answer);
  const stored: StoredRubric = {
    ...result,
    provider: llmProvider(),
    model: r.model,
    scoredAt: new Date().toISOString(),
    note: extractionNote,
  };
  await admin
    .from("materials")
    .update({
      rubric_r: stored,
      score: result.weightedMean,
      status: result.decision,
      // A new score replaces any earlier teacher override.
      override_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", materialId);
  return { status: result.decision };
}
