import "server-only";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads for the teacher area. Uses the teacher's own session, so Row Level
 * Security applies: staff see curriculum content and materials, and nothing
 * about learners or parents.
 */

const PackRow = z.object({
  id: z.string(),
  province: z.string(),
  grade: z.number(),
  subject: z.string(),
  source_title: z.string(),
  source_url: z.string().nullable(),
  published: z.boolean(),
  created_by: z.string().nullable(),
});
export type Pack = z.infer<typeof PackRow>;

export async function getPacks(): Promise<Pack[]> {
  await requireStaff();
  const db = await createClient();
  const r = await db.from("curricula").select("id, province, grade, subject, source_title, source_url, published, created_by").order("created_at");
  return z.array(PackRow).parse(r.data ?? []);
}

const OutcomeRow = z.object({
  code: z.string(),
  strand: z.string(),
  description_en: z.string(),
  bloom_level: z.string().nullable(),
  knowledge_type: z.string().nullable(),
  prerequisites: z.array(z.string()),
  status: z.enum(["draft", "approved"]),
  published: z.boolean(),
  created_by: z.string().nullable(),
  indicators: z.array(z.object({ code: z.string(), description: z.string() })),
  misconceptions: z.array(z.object({ code: z.string(), description: z.string() })),
});
export type TeacherOutcome = z.infer<typeof OutcomeRow>;

const StrandRow = z.object({ code: z.string(), name_en: z.string(), curriculum_id: z.string().nullable() });

const MaterialRow = z.object({
  id: z.string(),
  title: z.string(),
  outcome_codes: z.array(z.string()),
  source_url: z.string().nullable(),
  storage_path: z.string().nullable(),
  mime_type: z.string().nullable(),
  licence: z.string(),
  licence_note: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  score: z.coerce.number().nullable(),
  rubric_r: z.unknown().nullable(),
  override_reason: z.string().nullable(),
  created_at: z.string(),
  curriculum_id: z.string(),
});
export type MaterialView = z.infer<typeof MaterialRow>;

export async function getPack(id: string) {
  await requireStaff();
  const db = await createClient();
  const [pack, strands, outcomes, materials] = await Promise.all([
    db.from("curricula").select("id, province, grade, subject, source_title, source_url, published, created_by").eq("id", id).maybeSingle(),
    db.from("strands").select("code, name_en, curriculum_id").order("sort_order"),
    db
      .from("outcomes")
      .select("code, strand, description_en, bloom_level, knowledge_type, prerequisites, status, published, created_by, indicators(code, description), misconceptions(code, description)")
      .eq("curriculum_id", id)
      .order("sort_order"),
    db
      .from("materials")
      .select("id, title, outcome_codes, source_url, storage_path, mime_type, licence, licence_note, status, score, rubric_r, override_reason, created_at, curriculum_id")
      .eq("curriculum_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const p = PackRow.safeParse(pack.data);
  if (!p.success) return null;
  return {
    pack: p.data,
    // Strands of this pack plus the shared ones (seeded with the first pack).
    strands: z.array(StrandRow).parse(strands.data ?? []).filter((s) => s.curriculum_id === id || s.curriculum_id === "00000000-0000-4000-8000-000000000008"),
    outcomes: z.array(OutcomeRow).parse(outcomes.data ?? []),
    materials: z.array(MaterialRow).parse(materials.data ?? []),
  };
}

const MaterialDetail = MaterialRow.extend({ uploaded_by: z.string().nullable(), extracted_text: z.string().nullable() });
export type MaterialDetailView = z.infer<typeof MaterialDetail>;

export async function getMaterial(id: string): Promise<MaterialDetailView | null> {
  await requireStaff();
  const db = await createClient();
  const r = await db
    .from("materials")
    .select("id, title, outcome_codes, source_url, storage_path, mime_type, licence, licence_note, status, score, rubric_r, override_reason, created_at, curriculum_id, uploaded_by, extracted_text")
    .eq("id", id)
    .maybeSingle();
  return MaterialDetail.safeParse(r.data).data ?? null;
}

/** Every outcome code in the system (codes are unique across packs). */
export async function existingOutcomeCodes(): Promise<Set<string>> {
  await requireStaff();
  const db = await createClient();
  const r = await db.from("outcomes").select("code");
  return new Set((r.data ?? []).map((x) => x.code as string));
}
