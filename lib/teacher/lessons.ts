import "server-only";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Generated lessons for teachers, read through teacher_lessons_v: a pseudonym
 * and the profile fields the lesson used, never the learner's id or name.
 */

const Row = z.object({
  id: z.string(),
  outcome_code: z.string(),
  pseudonym: z.string(),
  sample_profile: z.string().nullable(),
  profile_used: z.record(z.string(), z.unknown()),
  lesson: z.unknown(),
  rationale: z.record(z.string(), z.unknown()),
  rubric_s: z.unknown(),
  fit_score: z.number().nullable(),
  status: z.enum(["generating", "delivered", "review", "approved", "rejected", "failed"]),
  attempts: z.number(),
  error: z.string().nullable(),
  created_at: z.string(),
});
export type TeacherLesson = z.infer<typeof Row>;

export async function getGeneratedLessons(): Promise<Omit<TeacherLesson, "lesson" | "rationale" | "rubric_s" | "profile_used">[]> {
  await requireStaff();
  const db = await createClient();
  const { data } = await db
    .from("teacher_lessons_v")
    .select("id, outcome_code, pseudonym, sample_profile, fit_score, status, attempts, error, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return z.array(Row.omit({ lesson: true, rationale: true, rubric_s: true, profile_used: true })).parse(data ?? []);
}

export async function getGeneratedLesson(id: string): Promise<TeacherLesson | null> {
  await requireStaff();
  const db = await createClient();
  const { data } = await db.from("teacher_lessons_v").select("*").eq("id", id).maybeSingle();
  return Row.safeParse(data).data ?? null;
}

const ReviewRow = z.object({ id: z.string(), decision: z.string(), notes: z.string().nullable(), fit_score: z.number().nullable(), created_at: z.string() });

export async function getLessonReviews(lessonId: string) {
  await requireStaff();
  const db = await createClient();
  const { data } = await db.from("lesson_reviews").select("id, decision, notes, fit_score, created_at").eq("lesson_id", lessonId).order("created_at", { ascending: false });
  return z.array(ReviewRow).parse(data ?? []);
}
