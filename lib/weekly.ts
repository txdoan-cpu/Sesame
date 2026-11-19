import type { WeeklySlot } from "@/lib/time";
import { localNow, slotStartOn, weekKey, weekStart } from "@/lib/time";
import { addDays } from "date-fns";

/**
 * Weekly report (§3, §7.5). Pure: callers load the data. Only items the
 * parent may see go in: attendance and reward progress are locked (always
 * shared); outcome changes only when the learner shares outcome status.
 */

export type WeekSession = { scheduled_for: string | null; started_at: string | null; active_seconds: number; idle_seconds: number; engagement: string | null };
export type WeekReward = { reward_text: string; achieved: number; total: number; status: string };

export type WeeklySummary = {
  week: string; // Monday, yyyy-MM-dd
  scheduled: number; // slot occurrences this week up to now
  attended: number; // of those, sessions that started in the slot
  sessions: number;
  activeMinutes: number;
  idleMinutes: number;
  engagement: { active: number; passive: number; away: number };
  rewards: WeekReward[];
  /** null = the learner keeps outcome status private */
  outcomesAchieved: string[] | null;
};

export function buildWeeklySummary(input: {
  now: Date;
  slots: WeeklySlot[];
  sessions: WeekSession[];
  rewards: WeekReward[];
  outcomesAchieved: string[] | null;
}): WeeklySummary {
  const start = weekStart(input.now);
  const inWeek = input.sessions.filter((s) => s.started_at && new Date(s.started_at) >= start && new Date(s.started_at) <= input.now);

  // Count slot occurrences from Monday up to now.
  let scheduled = 0;
  let attended = 0;
  const monday = localNow(start);
  for (let d = 0; d < 7; d++) {
    const day = localNow(addDays(monday, d));
    for (const slot of input.slots) {
      if (!slot.active || slot.weekday !== day.getDay()) continue;
      const slotStart = slotStartOn(day, slot.start_time).getTime();
      if (slotStart > input.now.getTime()) continue;
      scheduled++;
      const windowOpen = slotStart - 30 * 60_000;
      const windowClose = slotStart + slot.duration_min * 60_000;
      if (inWeek.some((s) => s.started_at && +new Date(s.started_at) >= windowOpen && +new Date(s.started_at) <= windowClose)) attended++;
    }
  }

  const engagement = { active: 0, passive: 0, away: 0 };
  for (const s of inWeek) if (s.engagement && s.engagement in engagement) engagement[s.engagement as keyof typeof engagement]++;

  return {
    week: weekKey(input.now),
    scheduled,
    attended,
    sessions: inWeek.length,
    activeMinutes: Math.round(inWeek.reduce((n, s) => n + s.active_seconds, 0) / 60),
    idleMinutes: Math.round(inWeek.reduce((n, s) => n + s.idle_seconds, 0) / 60),
    engagement,
    rewards: input.rewards,
    outcomesAchieved: input.outcomesAchieved,
  };
}
