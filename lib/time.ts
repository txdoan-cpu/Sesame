import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";

/** All schedule logic runs in the family's local time: St. John's, NL (UTC−3:30 / −2:30). */
export const FAMILY_TZ = "America/St_Johns";

export function localNow(now: Date = new Date()): TZDate {
  return new TZDate(now.getTime(), FAMILY_TZ);
}

/** "HH:mm[:ss]" -> minutes after midnight. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The instant a weekly slot starts on the local day of `day`. */
export function slotStartOn(day: TZDate, startTime: string): TZDate {
  const [h, m] = startTime.split(":").map(Number);
  return new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, FAMILY_TZ);
}

export type WeeklySlot = { id: string; weekday: number; start_time: string; duration_min: number; active: boolean };

/**
 * The scheduled slot a session belongs to: an active slot today whose window
 * (30 min early → end of slot) contains `now`.
 */
export function currentSlot<T extends WeeklySlot>(slots: T[], now: Date): { slot: T; start: Date } | null {
  const local = localNow(now);
  for (const slot of slots) {
    if (!slot.active || slot.weekday !== local.getDay()) continue;
    const start = slotStartOn(local, slot.start_time);
    const opens = start.getTime() - 30 * 60_000;
    const closes = start.getTime() + slot.duration_min * 60_000;
    if (now.getTime() >= opens && now.getTime() <= closes) return { slot, start: new Date(start.getTime()) };
  }
  return null;
}

/** Slots that ended earlier today (local), with their start instants. */
export function slotsEndedToday<T extends WeeklySlot>(slots: T[], now: Date): { slot: T; start: Date; end: Date }[] {
  const local = localNow(now);
  return slots.flatMap((slot) => {
    if (!slot.active || slot.weekday !== local.getDay()) return [];
    const start = slotStartOn(local, slot.start_time);
    const end = new Date(start.getTime() + slot.duration_min * 60_000);
    return end.getTime() < now.getTime() ? [{ slot, start: new Date(start.getTime()), end }] : [];
  });
}

/**
 * A make-up time for a missed slot: the next day at the same time, moved on
 * when that day already has a slot.
 */
export function proposeMakeUp(missed: WeeklySlot, slots: WeeklySlot[]): { weekday: number; start_time: string } {
  const busy = new Set(slots.filter((s) => s.active).map((s) => s.weekday));
  for (let i = 1; i <= 7; i++) {
    const day = (missed.weekday + i) % 7;
    if (!busy.has(day)) return { weekday: day, start_time: missed.start_time.slice(0, 5) };
  }
  return { weekday: (missed.weekday + 1) % 7, start_time: missed.start_time.slice(0, 5) };
}

/** Local calendar date "yyyy-MM-dd". */
export function localDate(now: Date): string {
  return format(localNow(now), "yyyy-MM-dd");
}

/** Monday of the local week, "yyyy-MM-dd" (weekly reports key on it). */
export function weekKey(now: Date): string {
  return format(startOfWeek(localNow(now), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/** Start of the local week (Monday 00:00) as an instant. */
export function weekStart(now: Date): Date {
  const monday = startOfWeek(localNow(now), { weekStartsOn: 1 });
  return new Date(new TZDate(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0, FAMILY_TZ).getTime());
}

export function addLocalDays(now: Date, days: number): Date {
  return new Date(addDays(localNow(now), days).getTime());
}
