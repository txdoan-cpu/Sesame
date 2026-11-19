import { describe, expect, it } from "vitest";
import { evaluateRule, milestoneKind, newMilestones, praiseSentence, type EvalAssessment } from "@/lib/rewards";

// Demo scenario B: 8PR1 + 8PR2, min 85%, retention after 7 days, deadline 15 Dec 2026, 50 CAD.
const rule = { outcomes: ["8PR1", "8PR2"], min_score: 0.85, retention_days: 7, deadline: "2026-12-15", status: "active" as const };
const deadlineEnd = new Date("2026-12-16T02:29:59Z"); // 23:59:59 in St. John's
const a = (outcome_code: string, taken_at: string, score = 1, kind: EvalAssessment["kind"] = "exit", mastered = true): EvalAssessment => ({
  outcome_code,
  kind,
  score,
  mastered,
  taken_at,
});

describe("evaluateRule (§7.4)", () => {
  it("8PR2 reached first: a milestone, not an unlock (halfway there)", () => {
    const ev = evaluateRule(rule, [a("8PR2", "2026-11-18T23:00:00Z")], new Date("2026-11-18T23:01:00Z"), deadlineEnd);
    expect(ev.achieved.map((x) => x.outcome)).toEqual(["8PR2"]);
    expect(ev.unlock).toBe(false);
    expect(newMilestones(ev, [])).toEqual(["8PR2"]);
    expect(newMilestones(ev, ["8PR2"])).toEqual([]);
    expect(milestoneKind(ev.achieved.length, rule.outcomes.length)).toBe("halfway");
  });

  it("does not count a score below the minimum, or a result without the balance explanation", () => {
    const ev = evaluateRule(rule, [a("8PR2", "2026-11-18T23:00:00Z", 0.67), a("8PR1", "2026-11-18T23:00:00Z", 1, "exit", false)], new Date(), deadlineEnd);
    expect(ev.achieved).toEqual([]);
  });

  it("unlocks only after both are achieved AND re-checked ≥ 7 days later", () => {
    const both = [a("8PR1", "2026-11-01T23:00:00Z"), a("8PR2", "2026-11-10T23:00:00Z")];
    const now = new Date("2026-11-20T23:00:00Z");
    expect(evaluateRule(rule, both, now, deadlineEnd).unlock).toBe(false);

    const recheck8PR1 = a("8PR1", "2026-11-09T23:00:00Z", 1, "retention");
    const tooSoon8PR2 = a("8PR2", "2026-11-15T23:00:00Z", 1, "retention"); // 5 days later
    expect(evaluateRule(rule, [...both, recheck8PR1, tooSoon8PR2], now, deadlineEnd).unlock).toBe(false);

    const ok8PR2 = a("8PR2", "2026-11-17T23:00:00Z", 0.9, "retention"); // 7 days later
    const ev = evaluateRule(rule, [...both, recheck8PR1, ok8PR2], now, deadlineEnd);
    expect(ev.retained.sort()).toEqual(["8PR1", "8PR2"]);
    expect(ev.unlock).toBe(true);
    expect(ev.expire).toBe(false);
  });

  it("a failed re-check does not count", () => {
    const list = [a("8PR1", "2026-11-01T23:00:00Z"), a("8PR1", "2026-11-09T23:00:00Z", 0.67, "retention")];
    expect(evaluateRule({ ...rule, outcomes: ["8PR1"] }, list, new Date("2026-11-20T23:00:00Z"), deadlineEnd).unlock).toBe(false);
  });

  it("expires after the deadline day; unlocked or fulfilled goals never expire", () => {
    const after = new Date("2026-12-16T03:00:00Z");
    expect(evaluateRule(rule, [], after, deadlineEnd).expire).toBe(true);
    expect(evaluateRule(rule, [], new Date("2026-12-16T02:00:00Z"), deadlineEnd).expire).toBe(false); // still the 15th locally
    expect(evaluateRule({ ...rule, status: "unlocked" }, [], after, deadlineEnd).expire).toBe(false);
  });

  it("never looks at time online", () => {
    expect(Object.keys(rule)).not.toContain("minutes");
  });
});

describe("praiseSentence", () => {
  it("names a mistake the learner fixed (scenario B: the distributive mistake)", () => {
    expect(praiseSentence({ misconceptionsAtStart: ["M2", "M3"], misconceptionsNow: [], outcomes: ["8PR1", "8PR2"] })).toMatch(
      /fixed the distributive mistake yourself/,
    );
    expect(praiseSentence({ misconceptionsAtStart: ["M2", "M3"], misconceptionsNow: ["M2"], outcomes: ["8PR2"] })).toMatch(/signs right/);
  });

  it("falls back to effort and memory", () => {
    expect(praiseSentence({ misconceptionsAtStart: [], misconceptionsNow: [], outcomes: ["8PR2"] })).toMatch(/still remembered it/);
  });
});
