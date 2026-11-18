import { z } from "zod";

/** Weekly study slots (CLAUDE.md §7.6). Weekday 0 = Sunday … 6 = Saturday. */

export const SlotInputSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.coerce.number().int().min(10).max(120),
});

export type SlotInput = z.infer<typeof SlotInputSchema>;

/** Learner asks for a change to a slot, or for a new slot (scheduleId empty). */
export const ChangeRequestSchema = SlotInputSchema.extend({
  scheduleId: z.union([z.literal(""), z.uuid()]).optional(),
  note: z.string().trim().max(300).optional(),
});

/** "16:30:00" or "16:30" -> "16:30". */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export type Slot = { id: string; weekday: number; start_time: string; duration_min: number; active: boolean };

/** Slots in week order (Monday first, the way families plan a school week). */
export function sortSlots<T extends { weekday: number; start_time: string }>(slots: T[]): T[] {
  const order = (d: number) => (d + 6) % 7;
  return [...slots].sort((a, b) => order(a.weekday) - order(b.weekday) || a.start_time.localeCompare(b.start_time));
}
