import { describe, expect, it } from "vitest";
import {
  AWAY_ALERT_MS,
  CHECKPOINT_TIMEOUT_MS,
  MAX_HEARTBEAT_SECONDS,
  clampHeartbeat,
  classifyEngagement,
  isActive,
  shouldPauseForCheckpoint,
  shouldSendAwayAlert,
} from "@/lib/engagement";
import { currentSlot, proposeMakeUp, slotsEndedToday, weekKey } from "@/lib/time";
import { buildWeeklySummary } from "@/lib/weekly";

const T = 1_000_000_000_000;
const base = { now: T, tabVisible: true, lastInteractionAt: T, narrationPlaying: false, narrationStartedAt: null };

describe("isActive (§7.5)", () => {
  it("counts recent interaction while the tab is visible", () => {
    expect(isActive(base)).toBe(true);
    expect(isActive({ ...base, now: T + 60_000 })).toBe(true);
    expect(isActive({ ...base, now: T + 60_001 })).toBe(false);
  });

  it("never counts a hidden tab", () => {
    expect(isActive({ ...base, tabVisible: false })).toBe(false);
  });

  it("counts listening to narration that started after the last interaction", () => {
    const later = { ...base, now: T + 120_000, narrationPlaying: true };
    expect(isActive({ ...later, narrationStartedAt: T + 90_000 })).toBe(true);
    // Narration that was already playing before the learner went quiet does not count.
    expect(isActive({ ...later, narrationStartedAt: T - 1_000 })).toBe(false);
  });
});

describe("session rating", () => {
  it.each([
    [80, 20, "active"],
    [79, 21, "passive"],
    [50, 50, "passive"],
    [49, 51, "away"],
    [0, 0, "away"],
  ] as const)("%s active / %s idle -> %s", (a, i, r) => {
    expect(classifyEngagement(a, i)).toBe(r);
  });
});

describe("pause and alert thresholds", () => {
  it("pauses after 60 s without an answer, not while narration plays", () => {
    const p = { now: T + CHECKPOINT_TIMEOUT_MS, checkpointOpen: true, lastInteractionAt: T, narrationPlaying: false, paused: false };
    expect(shouldPauseForCheckpoint(p)).toBe(true);
    expect(shouldPauseForCheckpoint({ ...p, now: T + 59_000 })).toBe(false);
    expect(shouldPauseForCheckpoint({ ...p, narrationPlaying: true })).toBe(false);
    expect(shouldPauseForCheckpoint({ ...p, checkpointOpen: false })).toBe(false);
    expect(shouldPauseForCheckpoint({ ...p, paused: true })).toBe(false);
  });

  it("alerts once, only for scheduled sessions, after 5 minutes away", () => {
    const secs = AWAY_ALERT_MS / 1000;
    expect(shouldSendAwayAlert({ scheduled: true, awaySeconds: secs, alreadySent: false })).toBe(true);
    expect(shouldSendAwayAlert({ scheduled: true, awaySeconds: secs - 1, alreadySent: false })).toBe(false);
    expect(shouldSendAwayAlert({ scheduled: false, awaySeconds: secs * 3, alreadySent: false })).toBe(false);
    expect(shouldSendAwayAlert({ scheduled: true, awaySeconds: secs * 3, alreadySent: true })).toBe(false);
  });

  it("clamps what one heartbeat may add", () => {
    expect(clampHeartbeat(10, 5)).toEqual({ active: 10, idle: 5 });
    const c = clampHeartbeat(3000, 1000);
    expect(c.active + c.idle).toBeLessThanOrEqual(MAX_HEARTBEAT_SECONDS);
    expect(clampHeartbeat(-5, 2.7)).toEqual({ active: 0, idle: 2 });
  });
});

describe("St. John's time", () => {
  // Wednesday 18 Nov 2026, 19:05 in St. John's (UTC−3:30) = 22:35 UTC.
  const wed1905 = new Date("2026-11-18T22:35:00Z");
  const slot = { id: "s", weekday: 3, start_time: "19:00:00", duration_min: 30, active: true };

  it("finds the slot a session belongs to (30 min early to the end)", () => {
    expect(currentSlot([slot], wed1905)?.slot.id).toBe("s");
    expect(currentSlot([slot], new Date("2026-11-18T22:00:00Z"))?.slot.id).toBe("s"); // 18:30
    expect(currentSlot([slot], new Date("2026-11-18T21:59:00Z"))).toBeNull(); // 18:29
    expect(currentSlot([{ ...slot, weekday: 4 }], wed1905)).toBeNull();
    expect(currentSlot([{ ...slot, active: false }], wed1905)).toBeNull();
  });

  it("lists slots that ended earlier today", () => {
    expect(slotsEndedToday([slot], wed1905)).toEqual([]);
    const later = new Date("2026-11-18T23:31:00Z"); // 20:01
    expect(slotsEndedToday([slot], later).map((s) => s.slot.id)).toEqual(["s"]);
  });

  it("proposes the next free day at the same time", () => {
    expect(proposeMakeUp(slot, [slot])).toEqual({ weekday: 4, start_time: "19:00" });
    expect(proposeMakeUp(slot, [slot, { ...slot, id: "t", weekday: 4 }])).toEqual({ weekday: 5, start_time: "19:00" });
  });

  it("keys weeks on Monday", () => {
    expect(weekKey(wed1905)).toBe("2026-11-16");
  });
});

describe("weekly report", () => {
  it("counts scheduled vs attended and active minutes", () => {
    const now = new Date("2026-11-20T23:00:00Z"); // Friday 19:30 local
    const slots = [
      { id: "mon", weekday: 1, start_time: "19:00", duration_min: 30, active: true },
      { id: "wed", weekday: 3, start_time: "19:00", duration_min: 30, active: true },
      { id: "sat", weekday: 6, start_time: "10:00", duration_min: 30, active: true }, // later this week
    ];
    const summary = buildWeeklySummary({
      now,
      slots,
      sessions: [
        // Monday 19:05 local = 22:35 UTC, in the slot.
        { scheduled_for: "2026-11-16T22:30:00Z", started_at: "2026-11-16T22:35:00Z", active_seconds: 900, idle_seconds: 120, engagement: "active" },
        // Last week: ignored.
        { scheduled_for: null, started_at: "2026-11-10T22:35:00Z", active_seconds: 600, idle_seconds: 0, engagement: "active" },
      ],
      rewards: [{ reward_text: "Skates", achieved: 1, total: 2, status: "active" }],
      outcomesAchieved: null,
    });
    expect(summary).toMatchObject({ week: "2026-11-16", scheduled: 2, attended: 1, sessions: 1, activeMinutes: 15, idleMinutes: 2, outcomesAchieved: null });
    expect(summary.engagement).toEqual({ active: 1, passive: 0, away: 0 });
  });
});
