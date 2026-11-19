import { connection } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/ask/feedback: "Was this helpful?" on an answer (questions.helpful).

const InputSchema = z.object({ questionId: z.uuid(), helpful: z.boolean() });

export async function POST(request: Request) {
  await connection();
  const user = await getCurrentUser();
  if (!user || user.role !== "learner") return Response.json({ ok: false, code: "not_signed_in" }, { status: 401 });
  const parsed = InputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });

  // Only the learner's own question can be rated.
  const res = await createAdminClient()
    .from("questions")
    .update({ helpful: parsed.data.helpful })
    .eq("id", parsed.data.questionId)
    .eq("learner_id", user.id)
    .select("id");
  if (res.error || !res.data?.length) return Response.json({ ok: false, code: "not_found" }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
