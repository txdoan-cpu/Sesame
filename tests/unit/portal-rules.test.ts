import { describe, expect, it } from "vitest";
import { SHARING_ITEMS, canLearnerChange, effectiveSharing, isSharingItem } from "@/lib/sharing";
import { RewardRuleInputSchema, isFutureDate, rewardFeasibility, rewardProgress } from "@/lib/rewards";
import { ChangeRequestSchema, SlotInputSchema, hhmm, sortSlots } from "@/lib/schedule";

describe("sharing rules (§7.3)", () => {
  it("matches the table in CLAUDE.md", () => {
    expect(SHARING_ITEMS.map((s) => [s.item, s.defaultShared, s.locked])).toEqual([
      ["attendance", true, true],
      ["safety_alerts", true, true],
      ["reward_progress", true, true],
      ["outcome_status", true, false],
      ["scores", true, false],
      ["question_summaries", false, false],
      ["misconceptions", false, false],
    ]);
  });

  it("learners can change only unlocked items", () => {
    expect(canLearnerChange("attendance")).toBe(false);
    expect(canLearnerChange("safety_alerts")).toBe(false);
    expect(canLearnerChange("reward_progress")).toBe(false);
    expect(canLearnerChange("outcome_status")).toBe(true);
    expect(canLearnerChange("misconceptions")).toBe(true);
    expect(isSharingItem("passwords")).toBe(false);
  });

  it("locked items stay shared even if a stored row says otherwise", () => {
    const e = effectiveSharing([
      { item: "attendance", shared: false },
      { item: "scores", shared: false },
      { item: "misconceptions", shared: true },
      { item: "unknown", shared: true },
    ]);
    expect(e.attendance).toBe(true);
    expect(e.scores).toBe(false);
    expect(e.misconceptions).toBe(true);
    expect(e.question_summaries).toBe(false); // default
  });
});

describe("reward rules (§7.4)", () => {
  const base = {
    learnerId: "11111111-1111-4111-8111-111111111111",
    outcomes: ["8PR2", "8PR2", "8N7"],
    minScorePercent: "80",
    deadline: "2027-01-31",
    rewardText: "  New hockey stick ",
    value: "50",
  };

  it("parses the parent form (deduped outcomes, default retention 7 days)", () => {
    const r = RewardRuleInputSchema.parse(base);
    expect(r.outcomes).toEqual(["8PR2", "8N7"]);
    expect(r.retentionDays).toBe(7);
    expect(r.minScorePercent).toBe(80);
    expect(r.rewardText).toBe("New hockey stick");
    expect(r.value).toBe(50);
    expect(RewardRuleInputSchema.parse({ ...base, value: "" }).value).toBeUndefined();
  });

  it("rejects bad input", () => {
    expect(RewardRuleInputSchema.safeParse({ ...base, outcomes: [] }).success).toBe(false);
    expect(RewardRuleInputSchema.safeParse({ ...base, outcomes: ["9XX1"] }).success).toBe(false);
    expect(RewardRuleInputSchema.safeParse({ ...base, minScorePercent: "40" }).success).toBe(false);
    expect(RewardRuleInputSchema.safeParse({ ...base, rewardText: "" }).success).toBe(false);
    expect(RewardRuleInputSchema.safeParse({ ...base, deadline: "next week" }).success).toBe(false);
  });

  it("has no notion of time online", () => {
    expect(Object.keys(RewardRuleInputSchema.parse(base))).not.toContain("minutes");
  });

  it("checks the deadline is in the future", () => {
    const today = new Date("2026-11-18T12:00:00Z");
    expect(isFutureDate("2026-11-19", today)).toBe(true);
    expect(isFutureDate("2026-11-18", today)).toBe(false);
  });

  it("progress counts achieved outcomes", () => {
    expect(rewardProgress([true, false])).toEqual({ achieved: 1, total: 2, percent: 50 });
    expect(rewardProgress([])).toEqual({ achieved: 0, total: 0, percent: 0 });
  });

  it("warns when a goal is very unlikely before the deadline", () => {
    const today = new Date("2026-11-18T12:00:00Z");
    const rule = (deadline: string, outcomes = ["8PR2", "8N7"]) => ({ outcomes, deadline, retentionDays: 7 });
    // 2 outcomes left -> 14 days + 7 retention = 21 days needed.
    expect(rewardFeasibility(rule("2026-11-25"), new Set(), today)).toMatchObject({ feasibility: "unlikely", daysLeft: 7, daysNeeded: 21 });
    expect(rewardFeasibility(rule("2026-12-15"), new Set(), today).feasibility).toBe("at_risk");
    expect(rewardFeasibility(rule("2027-01-31"), new Set(), today).feasibility).toBe("on_track");
    // Already achieved outcomes need only the retention check.
    expect(rewardFeasibility(rule("2026-11-28"), new Set(["8PR2", "8N7"]), today).feasibility).toBe("at_risk");
  });
});

describe("schedule (§7.6)", () => {
  it("validates slots and requests", () => {
    expect(SlotInputSchema.parse({ weekday: "1", startTime: "16:30", durationMin: "20" })).toEqual({ weekday: 1, startTime: "16:30", durationMin: 20 });
    expect(SlotInputSchema.safeParse({ weekday: 7, startTime: "16:30", durationMin: 20 }).success).toBe(false);
    expect(SlotInputSchema.safeParse({ weekday: 1, startTime: "25:00", durationMin: 20 }).success).toBe(false);
    expect(SlotInputSchema.safeParse({ weekday: 1, startTime: "16:30", durationMin: 5 }).success).toBe(false);
    expect(ChangeRequestSchema.safeParse({ scheduleId: "", weekday: 2, startTime: "17:00", durationMin: 20 }).success).toBe(true);
    expect(ChangeRequestSchema.safeParse({ scheduleId: "nope", weekday: 2, startTime: "17:00", durationMin: 20 }).success).toBe(false);
  });

  it("formats and sorts Monday first", () => {
    expect(hhmm("16:30:00")).toBe("16:30");
    const sorted = sortSlots([
      { weekday: 0, start_time: "10:00" },
      { weekday: 3, start_time: "16:00" },
      { weekday: 1, start_time: "17:00" },
      { weekday: 1, start_time: "09:00" },
    ]);
    expect(sorted.map((s) => `${s.weekday}@${s.start_time}`)).toEqual(["1@09:00", "1@17:00", "3@16:00", "0@10:00"]);
  });
});
