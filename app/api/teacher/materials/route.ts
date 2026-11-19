import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/dal";
import { ALLOWED_MATERIAL_TYPES, MAX_MATERIAL_BYTES, extractFromFile, extractFromUrl } from "@/lib/materials/extract";
import { reviewMaterial } from "@/lib/materials/review";
import { MaterialInputSchema } from "@/lib/teacher/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// POST /api/teacher/materials (multipart): a teacher uploads a file or links a URL,
// with a licence, for one or more outcomes of a pack. The server stores the file
// in the private "materials" bucket, extracts the text and scores Rubric R.
// A route handler (not a server action) so files up to 10 MB are accepted locally.

export type MaterialUploadResponse = { ok: true; id: string; status: string } | { ok: false; code: string; detail?: string };

const EXT_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv" };

function typeFromName(name: string): string {
  return EXT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function reply(body: MaterialUploadResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await connection();
  const user = await getCurrentUser();
  if (!user || (user.role !== "teacher" && user.role !== "admin")) return reply({ ok: false, code: "not_allowed" }, 403);

  const form = await request.formData().catch(() => null);
  if (!form) return reply({ ok: false, code: "invalid_input" }, 400);
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const parsed = MaterialInputSchema.safeParse({
    packId: str("packId"),
    title: str("title"),
    outcomeCodes: form.getAll("outcomeCodes").filter((v): v is string => typeof v === "string"),
    licence: str("licence"),
    licenceNote: str("licenceNote") || undefined,
    sourceUrl: str("sourceUrl"),
  });
  if (!parsed.success) {
    return reply({ ok: false, code: "invalid_input", detail: parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ") }, 400);
  }
  const input = parsed.data;
  const file = form.get("file");
  const hasFile = file instanceof File && file.size > 0;
  // Some browsers send no type for .md / .csv files; fall back to the extension.
  const fileType = hasFile ? file.type || typeFromName(file.name) : "";
  if (!hasFile && !input.sourceUrl) return reply({ ok: false, code: "file_or_url" }, 400);
  if (hasFile && file.size > MAX_MATERIAL_BYTES) return reply({ ok: false, code: "too_large" }, 413);
  if (hasFile && !(ALLOWED_MATERIAL_TYPES as readonly string[]).includes(fileType)) return reply({ ok: false, code: "file_type" }, 415);

  // The pack and outcomes must exist and be visible to this teacher (RLS).
  const db = await createClient();
  const { data: outcomes } = await db.from("outcomes").select("code").eq("curriculum_id", input.packId).in("code", input.outcomeCodes);
  if ((outcomes ?? []).length !== new Set(input.outcomeCodes).size) return reply({ ok: false, code: "unknown_outcome" }, 400);

  const admin = createAdminClient();
  const created = await admin
    .from("materials")
    .insert({
      curriculum_id: input.packId,
      outcome_codes: input.outcomeCodes,
      title: input.title,
      source_url: input.sourceUrl || null,
      licence: input.licence,
      licence_note: input.licenceNote ?? null,
      // Placeholder until the file is stored (the check needs a file or a URL).
      storage_path: hasFile ? "uploading" : null,
      mime_type: hasFile ? fileType : null,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (created.error || !created.data) return reply({ ok: false, code: "save_failed" }, 500);
  const id = created.data.id as string;

  let text = "";
  let note: string | null = null;
  if (hasFile) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
    const path = `${input.packId}/${id}/${safeName}`;
    const up = await admin.storage.from("materials").upload(path, bytes, { contentType: fileType, upsert: false });
    if (up.error) {
      await admin.from("materials").delete().eq("id", id);
      return reply({ ok: false, code: "upload_failed" }, 500);
    }
    await admin.from("materials").update({ storage_path: path }).eq("id", id);
    ({ text, note } = await extractFromFile(bytes, fileType));
  } else if (input.sourceUrl) {
    const got = await extractFromUrl(input.sourceUrl);
    text = got.text;
    note = got.note;
    if (got.mimeType) await admin.from("materials").update({ mime_type: got.mimeType }).eq("id", id);
  }
  await admin.from("materials").update({ extracted_text: text.slice(0, 200_000) }).eq("id", id);

  const review = await reviewMaterial(id, note);
  revalidatePath(`/teacher/pack/${input.packId}`);
  return reply({ ok: true, id, status: review.status });
}
