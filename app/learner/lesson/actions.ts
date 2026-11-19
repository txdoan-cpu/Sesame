"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { getLesson } from "@/lib/lesson/registry";
import { saveExitTicket } from "@/lib/lesson/save";
import { createClient } from "@/lib/supabase/server";
import type { OutcomeStatusKind } from "@/lib/learner-profile";

const InputSchema = z.object({
  lessonId: z.string().max(100),
  choices: z.record(z.string().max(20), z.string().max(20)),
  explanation: z.string().max(2000),
  kind: z.enum(["exit", "retention"]).default("exit"),
});

export type ExitSummary =
  | {
      ok: true;
      score: number;
      correctCount: number;
      total: number;
      explainedBalance: boolean;
      mastered: boolean;
      status: OutcomeStatusKind;
      items: { item: string; correct: boolean; misconception: string | null }[];
    }
  | { ok: false; error: "not_signed_in" | "invalid_input" | "save_failed" };

async function retentionReady(learnerId: string, outcome: string): Promise<boolean> {
  const db = await createClient();
  const { data } = await db.from("outcome_status").select("status").eq("learner_id", learnerId).eq("outcome_code", outcome).maybeSingle();
  return data?.status === "achieved" || data?.status === "retained";
}

/** Learner finishes the exit ticket (or a retention check). Scored and saved on the server. */
export async function submitExitTicket(input: unknown): Promise<ExitSummary> {
  const user = await getCurrentUser();
  if (!user || user.role !== "learner") return { ok: false, error: "not_signed_in" };

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const lesson = getLesson(parsed.data.lessonId);
  if (!lesson) return { ok: false, error: "invalid_input" };
  // A retention check only makes sense once the outcome was reached.
  if (parsed.data.kind === "retention" && !(await retentionReady(user.id, lesson.outcome_code))) {
    return { ok: false, error: "invalid_input" };
  }

  try {
    const saved = await saveExitTicket(
      user.id,
      lesson,
      { choices: parsed.data.choices, explanation: parsed.data.explanation },
      new Date(),
      parsed.data.kind,
    );
    // The goals board and rewards on the learner home show the new status.
    revalidatePath("/learner", "layout");
    revalidatePath("/parent", "layout");
    return {
      ok: true,
      score: saved.score,
      correctCount: saved.correctCount,
      total: saved.total,
      explainedBalance: saved.explainedBalance,
      mastered: saved.mastered,
      status: saved.status,
      items: saved.items.map((i) => ({ item: i.item, correct: i.correct, misconception: i.misconception })),
    };
  } catch (err) {
    console.error("submitExitTicket failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "save_failed" };
  }
}
