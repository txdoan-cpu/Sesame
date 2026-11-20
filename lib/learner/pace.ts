import { z } from "zod";
import raw from "@/content/pedagogy/pace.json";
import type { LearningRateLevel } from "./bkt";

/** Pace table (Appendix C) as data: content/pedagogy/pace.json. */

const PerLevel = <T extends z.ZodType>(t: T) => z.object({ slow: t, medium: t, fast: t });
const Range = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

export const PaceTableSchema = z.object({
  levels: z.tuple([z.literal("slow"), z.literal("medium"), z.literal("fast")]),
  segment_minutes_max: PerLevel(z.number().positive()),
  worked_examples_before_fading: PerLevel(z.number().int().min(0)),
  check_every_minutes: PerLevel(z.number().positive()),
  practice_items: PerLevel(Range),
  transfer_items: PerLevel(z.number().int().min(0)),
  review_after_days: PerLevel(z.array(z.number().int().positive())),
  narration_rate: PerLevel(z.number().min(0.5).max(2)),
});

export const PACE_TABLE = PaceTableSchema.parse(raw);

export type Pace = {
  level: LearningRateLevel;
  segmentMinutesMax: number;
  workedExamplesBeforeFading: number;
  checkEveryMinutes: number;
  /** [min, max] practice items. */
  practiceItems: [number, number];
  transferItems: number;
  reviewAfterDays: number[];
  narrationRate: number;
};

export function paceFor(level: LearningRateLevel): Pace {
  const t = PACE_TABLE;
  return {
    level,
    segmentMinutesMax: t.segment_minutes_max[level],
    workedExamplesBeforeFading: t.worked_examples_before_fading[level],
    checkEveryMinutes: t.check_every_minutes[level],
    practiceItems: t.practice_items[level],
    transferItems: t.transfer_items[level],
    reviewAfterDays: t.review_after_days[level],
    narrationRate: t.narration_rate[level],
  };
}

export const LevelSchema = z.enum(["slow", "medium", "fast"]);
