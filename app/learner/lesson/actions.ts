"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/dal";
import { getLesson } from "@/lib/lesson/registry";
import { saveExitTicket } from "@/lib/lesson/save";
import type { OutcomeStatusKind } from "@/lib/learner-profile";

const InputSchema = z.object({
  lessonId: z.string().max(100),
  choices: z.record(z.string().max(20), z.string().max(20)),
  explanation: z.string().max(2000),
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

/** Learner finishes the exit ticket. Scored and saved on the server. */
export async function submitExitTicket(input: unknown): Promise<ExitSummary> {
  const user = await getCurrentUser();
  if (!user || user.role !== "learner") return { ok: false, error: "not_signed_in" };

  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const lesson = getLesson(parsed.data.lessonId);
  if (!lesson) return { ok: false, error: "invalid_input" };

  try {
    const saved = await saveExitTicket(user.id, lesson, {
      choices: parsed.data.choices,
      explanation: parsed.data.explanation,
    });
    // The goals board on the learner home shows the new status.
    revalidatePath("/learner");
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
