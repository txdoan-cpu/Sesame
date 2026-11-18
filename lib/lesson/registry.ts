import lesson8PR2DemoA from "@/content/lessons/8PR2-demo-A.json";
import { LessonSchema, type Lesson } from "./schema";

/** Pre-authored lessons (the generation pipeline is out of scope for the demo). */
const LESSONS: Lesson[] = [LessonSchema.parse(lesson8PR2DemoA)];

export function getLesson(id: string): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}

export function getLessonForOutcome(outcomeCode: string): Lesson | null {
  return LESSONS.find((l) => l.outcome_code === outcomeCode) ?? null;
}

export function allLessons(): readonly Lesson[] {
  return LESSONS;
}
