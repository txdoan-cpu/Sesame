import "server-only";
import { deliverableById, deliverableLesson } from "@/lib/generation/pipeline";
import { getLesson, getLessonForOutcome } from "./registry";
import { LessonSchema, type Lesson } from "./schema";

/**
 * Lessons a learner may play: the pre-authored standard lessons, plus their own
 * generated lessons once delivered (Rubric S >= 75) or approved by a teacher
 * (CLAUDE.md §7.9). Until then the learner gets the standard lesson for the LO.
 */

/** A lesson by id, for this learner (standard, or their own deliverable generated lesson). */
export async function lessonForLearner(learnerId: string, lessonId: string): Promise<Lesson | null> {
  const standard = getLesson(lessonId);
  if (standard) return standard;
  const raw = await deliverableById(learnerId, lessonId);
  const p = LessonSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** What the learner plays today for an outcome: their generated lesson if ready, else the standard one. */
export async function todaysLesson(learnerId: string, outcomeCode: string): Promise<{ lesson: Lesson; generated: boolean } | null> {
  const gen = await deliverableLesson(learnerId, outcomeCode);
  if (gen) {
    const p = LessonSchema.safeParse(gen.lesson);
    if (p.success) return { lesson: p.data, generated: true };
  }
  const standard = getLessonForOutcome(outcomeCode);
  return standard ? { lesson: standard, generated: false } : null;
}
