"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireRole, requireStaff } from "@/lib/auth/dal";
import { reviewMaterial } from "@/lib/materials/review";
import { CurriculumInputSchema, OutcomeInputSchema, flagDuplicates, parseCodedList, parseOutcomeImport, type ImportRow, type OutcomeInput } from "@/lib/teacher/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Teacher actions (CLAUDE.md §7.7). Curriculum writes use the teacher's own
 * session, so Row Level Security and the draft/approved guards apply.
 * Materials are written by server code after a role check.
 */

export type TeacherState = { error?: string; ok?: boolean | string };

function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export async function createPack(_prev: TeacherState, fd: FormData): Promise<TeacherState> {
  await requireStaff();
  const p = CurriculumInputSchema.safeParse({
    province: field(fd, "province"),
    grade: field(fd, "grade"),
    subject: field(fd, "subject"),
    sourceTitle: field(fd, "sourceTitle"),
    sourceUrl: field(fd, "sourceUrl"),
  });
  if (!p.success) return { error: "invalid_input" };
  const db = await createClient();
  const r = await db
    .from("curricula")
    .insert({ province: p.data.province, grade: p.data.grade, subject: p.data.subject, source_title: p.data.sourceTitle, source_url: p.data.sourceUrl || null })
    .select("id")
    .single();
  if (r.error || !r.data) return { error: r.error?.code === "23505" ? "duplicate_pack" : "save_failed" };
  redirect(`/teacher/pack/${r.data.id}`);
}

export async function addStrand(_prev: TeacherState, fd: FormData): Promise<TeacherState> {
  await requireStaff();
  const p = z
    .object({ packId: z.uuid(), code: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/), name: z.string().trim().min(2).max(80) })
    .safeParse({ packId: field(fd, "packId"), code: field(fd, "code"), name: field(fd, "name") });
  if (!p.success) return { error: "invalid_input" };
  const db = await createClient();
  const r = await db.from("strands").insert({ code: p.data.code, name_en: p.data.name, curriculum_id: p.data.packId });
  if (r.error) return { error: r.error.code === "23505" ? "duplicate_code" : "save_failed" };
  revalidatePath(`/teacher/pack/${p.data.packId}`);
  return { ok: true };
}

/** Inserts one outcome with its indicators and misconceptions; undoes the outcome if a child row fails. */
async function insertOutcome(db: SupabaseClient, packId: string, o: OutcomeInput): Promise<string | null> {
  const r = await db.from("outcomes").insert({
    code: o.code,
    strand: o.strand,
    curriculum_id: packId,
    description_en: o.description,
    bloom_level: o.bloomLevel,
    knowledge_type: o.knowledgeType,
    prerequisites: o.prerequisites,
  });
  if (r.error) return r.error.code === "23505" ? "duplicate_code" : r.error.code === "23503" ? "unknown_strand" : "save_failed";
  const children = [
    o.indicators.length ? db.from("indicators").insert(o.indicators.map((i) => ({ outcome_code: o.code, code: i.code, description: i.description }))) : null,
    o.misconceptions.length
      ? db.from("misconceptions").insert(o.misconceptions.map((m) => ({ outcome_code: o.code, code: m.code, description: m.description })))
      : null,
  ];
  for (const c of children) {
    if (!c) continue;
    const res = await c;
    if (res.error) {
      await db.from("outcomes").delete().eq("code", o.code);
      return "save_failed";
    }
  }
  return null;
}

export async function createOutcome(_prev: TeacherState, fd: FormData): Promise<TeacherState> {
  await requireStaff();
  const packId = field(fd, "packId");
  const p = OutcomeInputSchema.safeParse({
    code: field(fd, "code"),
    strand: field(fd, "strand"),
    description: field(fd, "description"),
    bloomLevel: field(fd, "bloomLevel"),
    knowledgeType: field(fd, "knowledgeType"),
    indicators: parseCodedList(field(fd, "indicators")),
    misconceptions: parseCodedList(field(fd, "misconceptions")),
    prerequisites: field(fd, "prerequisites")
      .split(/[;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  });
  if (!p.success || !z.uuid().safeParse(packId).success) return { error: "invalid_input" };
  const db = await createClient();
  const { data: dup } = await db.from("outcomes").select("code").ilike("code", p.data.code).limit(1);
  if (dup?.length) return { error: "duplicate_code" };
  const err = await insertOutcome(db, packId, p.data);
  if (err) return { error: err };
  revalidatePath(`/teacher/pack/${packId}`);
  return { ok: true };
}

export type PreviewResult = { rows: ImportRow[]; fileError: string | null; ready: number };

/** Validates an import file and flags duplicates; nothing is saved. */
export async function previewImport(filename: string, text: string): Promise<PreviewResult> {
  await requireStaff();
  if (text.length > 500_000) return { rows: [], fileError: "The file is too large (500 KB max).", ready: 0 };
  const { rows, fileError } = parseOutcomeImport(text, filename);
  if (fileError) return { rows: [], fileError, ready: 0 };
  const db = await createClient();
  const [codes, strands] = await Promise.all([db.from("outcomes").select("code"), db.from("strands").select("code")]);
  const strandSet = new Set((strands.data ?? []).map((s) => s.code as string));
  const flagged = flagDuplicates(rows, new Set((codes.data ?? []).map((c) => c.code as string))).map((r) =>
    r.input && !strandSet.has(r.input.strand) ? { ...r, issues: [...r.issues, `unknown strand ${r.input.strand} (add it first)`] } : r,
  );
  return { rows: flagged, fileError: null, ready: flagged.filter((r) => r.input && !r.issues.length).length };
}

/** Saves an import. Re-checks everything on the server; refuses if any row has an issue. */
export async function saveImport(packId: string, filename: string, text: string): Promise<{ error?: string; saved?: number }> {
  await requireStaff();
  if (!z.uuid().safeParse(packId).success) return { error: "invalid_input" };
  const preview = await previewImport(filename, text);
  if (preview.fileError || preview.rows.some((r) => !r.input || r.issues.length)) return { error: "fix_issues_first" };
  const db = await createClient();
  let saved = 0;
  for (const r of preview.rows) {
    const err = await insertOutcome(db, packId, r.input!);
    if (err) return { error: `${r.input!.code}: ${err}`, saved };
    saved++;
  }
  revalidatePath(`/teacher/pack/${packId}`);
  return { saved };
}

const CodeAction = z.object({ code: z.string().min(1).max(20), packId: z.uuid() });

/** The teacher approves their own draft: it becomes read-only (admins can still edit). */
export async function approveOutcome(fd: FormData): Promise<void> {
  await requireStaff();
  const p = CodeAction.safeParse({ code: field(fd, "code"), packId: field(fd, "packId") });
  if (!p.success) return;
  const db = await createClient();
  await db.from("outcomes").update({ status: "approved" }).eq("code", p.data.code);
  revalidatePath(`/teacher/pack/${p.data.packId}`);
}

export async function deleteOutcome(fd: FormData): Promise<void> {
  await requireStaff();
  const p = CodeAction.safeParse({ code: field(fd, "code"), packId: field(fd, "packId") });
  if (!p.success) return;
  const db = await createClient();
  await db.from("indicators").delete().eq("outcome_code", p.data.code);
  await db.from("misconceptions").delete().eq("outcome_code", p.data.code);
  await db.from("outcomes").delete().eq("code", p.data.code);
  revalidatePath(`/teacher/pack/${p.data.packId}`);
}

export async function rescoreMaterial(fd: FormData): Promise<void> {
  await requireStaff();
  const id = z.uuid().safeParse(field(fd, "id"));
  if (!id.success) return;
  await reviewMaterial(id.data);
  revalidatePath(`/teacher/material/${id.data}`);
}

/** The teacher overrides the Rubric R decision with a written reason (kept with the scores). */
export async function overrideMaterial(_prev: TeacherState, fd: FormData): Promise<TeacherState> {
  const user = await requireStaff();
  const p = z
    .object({ id: z.uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(10).max(1000) })
    .safeParse({ id: field(fd, "id"), decision: field(fd, "decision"), reason: field(fd, "reason") });
  if (!p.success) return { error: "reason_required" };
  const admin = createAdminClient();
  const { data: m } = await admin.from("materials").select("uploaded_by, rubric_r").eq("id", p.data.id).maybeSingle();
  if (!m) return { error: "not_found" };
  if (m.uploaded_by !== user.id && user.role !== "admin") return { error: "not_allowed" };
  const rubric = (m.rubric_r ?? {}) as Record<string, unknown>;
  const r = await admin
    .from("materials")
    .update({
      status: p.data.decision,
      override_reason: p.data.reason,
      rubric_r: { ...rubric, override: { by: user.id, at: new Date().toISOString(), decision: p.data.decision, reason: p.data.reason } },
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.data.id);
  if (r.error) return { error: "save_failed" };
  revalidatePath(`/teacher/material/${p.data.id}`);
  return { ok: true };
}

const DEFAULT_PACK_ID = "00000000-0000-4000-8000-000000000008";

/**
 * Admin publishes a pack: the pack, its strands, and its APPROVED outcomes
 * (with their indicators and misconceptions) become visible to learners and
 * parents. Drafts stay hidden. The database is shared with the live demo, so
 * the form asks the admin to confirm.
 */
export async function setPackPublished(_prev: TeacherState, fd: FormData): Promise<TeacherState> {
  await requireRole("admin");
  const p = z
    .object({ packId: z.uuid(), publish: z.enum(["true", "false"]), confirm: z.literal("yes") })
    .safeParse({ packId: field(fd, "packId"), publish: field(fd, "publish"), confirm: field(fd, "confirm") });
  if (!p.success) return { error: "confirm_required" };
  const { packId } = p.data;
  const publish = p.data.publish === "true";
  // The original NL Grade 8 pack is what the live demo shows; it is never unpublished here.
  if (packId === DEFAULT_PACK_ID && !publish) return { error: "default_pack" };

  const db = await createClient();
  const { data: outcomes } = await db.from("outcomes").select("code, status").eq("curriculum_id", packId);
  const codes = (outcomes ?? []).filter((o) => !publish || o.status === "approved").map((o) => o.code as string);
  if (publish && codes.length === 0) return { error: "nothing_approved" };

  const results = await Promise.all([
    db.from("curricula").update({ published: publish }).eq("id", packId),
    db.from("strands").update({ published: publish }).eq("curriculum_id", packId),
    codes.length ? db.from("outcomes").update({ published: publish }).in("code", codes) : null,
    codes.length ? db.from("indicators").update({ published: publish }).in("outcome_code", codes) : null,
    codes.length ? db.from("misconceptions").update({ published: publish }).in("outcome_code", codes) : null,
  ]);
  if (results.some((r) => r?.error)) return { error: "save_failed" };
  revalidatePath(`/teacher/pack/${packId}`);
  revalidatePath("/teacher");
  revalidatePath("/learner", "layout");
  revalidatePath("/parent", "layout");
  return { ok: publish ? "published" : "unpublished" };
}
