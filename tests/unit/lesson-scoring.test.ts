import { describe, expect, it } from "vitest";
import raw from "@/content/lessons/8PR2-demo-A.json";
import demoA from "@/content/profiles/demo-A.json";
import { LessonSchema } from "@/lib/lesson/schema";
import { explainsBalance, nextOutcomeStatus, scoreExitTicket, updateMisconceptions } from "@/lib/lesson/scoring";

const lesson = LessonSchema.parse(raw);
const ALL_RIGHT = { e1: "a", e2: "b", e3: "c" };
const GOOD_EXPLAIN = "Whatever you do to one side you have to do to the other side so it stays balanced.";
const NOW = new Date("2026-11-18T20:00:00Z");

describe("explainsBalance", () => {
  it.each([
    "Keep it balanced",
    "do the same thing to both sides",
    "Do the same to each side",
    "whatever you do on one side do on the other side",
    "BALANCE!",
  ])("accepts %j", (text) => {
    expect(explainsBalance(text, lesson.exit_ticket.explain.keywords)).toBe(true);
  });

  it.each(["get x by itself", "divide first", "", "I don't know"])("rejects %j", (text) => {
    expect(explainsBalance(text, lesson.exit_ticket.explain.keywords)).toBe(false);
  });
});

describe("scoreExitTicket", () => {
  it("all right + explanation = mastered", () => {
    const r = scoreExitTicket(lesson, { choices: ALL_RIGHT, explanation: GOOD_EXPLAIN });
    expect(r).toMatchObject({ score: 1, correctCount: 3, total: 3, explainedBalance: true, mastered: true });
    expect(r.items.every((i) => i.misconception === null)).toBe(true);
  });

  it("all right but no balance explanation is not mastered", () => {
    const r = scoreExitTicket(lesson, { choices: ALL_RIGHT, explanation: "get x alone" });
    expect(r.mastered).toBe(false);
  });

  it("records the misconception behind each wrong choice", () => {
    const r = scoreExitTicket(lesson, { choices: { e1: "b", e2: "a", e3: "c" }, explanation: GOOD_EXPLAIN });
    expect(r.score).toBe(0.33);
    expect(r.items.map((i) => i.misconception)).toEqual(["M3", "M2", null]);
    expect(r.mastered).toBe(false);
  });

  it("missing or unknown answers count as wrong", () => {
    const r = scoreExitTicket(lesson, { choices: { e1: "zzz" }, explanation: "" });
    expect(r.correctCount).toBe(0);
    expect(r.items.map((i) => i.chosen)).toEqual([null, null, null]);
  });
});

describe("nextOutcomeStatus", () => {
  const mastered = scoreExitTicket(lesson, { choices: ALL_RIGHT, explanation: GOOD_EXPLAIN });
  const twoOfThree = scoreExitTicket(lesson, { choices: { ...ALL_RIGHT, e2: "a" }, explanation: GOOD_EXPLAIN });
  const allRightNoExplain = scoreExitTicket(lesson, { choices: ALL_RIGHT, explanation: "x alone" });

  it("first mastery -> achieved, with achieved_at now", () => {
    expect(nextOutcomeStatus(null, mastered, NOW)).toEqual({
      status: "achieved",
      mastery: 1,
      achieved_at: NOW.toISOString(),
      retained_at: null,
    });
  });

  it("2 of 3 -> nearly; full marks without the explanation -> nearly (capped)", () => {
    expect(nextOutcomeStatus(null, twoOfThree, NOW).status).toBe("nearly");
    expect(nextOutcomeStatus(null, allRightNoExplain, NOW).status).toBe("nearly");
  });

  it("mastered again >= 14 days later -> retained; sooner stays achieved", () => {
    const prev = { status: "achieved" as const, achieved_at: "2026-11-01T20:00:00Z", retained_at: null };
    expect(nextOutcomeStatus(prev, mastered, NOW).status).toBe("retained");
    const recent = { ...prev, achieved_at: "2026-11-10T20:00:00Z" };
    expect(nextOutcomeStatus(recent, mastered, NOW)).toMatchObject({ status: "achieved", achieved_at: recent.achieved_at });
  });

  it("a weaker result later keeps the first achievement date", () => {
    const prev = { status: "achieved" as const, achieved_at: "2026-11-10T20:00:00Z", retained_at: null };
    const next = nextOutcomeStatus(prev, twoOfThree, NOW);
    expect(next).toMatchObject({ status: "nearly", achieved_at: prev.achieved_at });
  });
});

describe("updateMisconceptions (demo-A)", () => {
  // Sub-skill mastery is the learner model's job since Round 9 (tests/unit/learner-model.test.ts).
  it("all right: clears M2 and M3", () => {
    const r = scoreExitTicket(lesson, { choices: ALL_RIGHT, explanation: GOOD_EXPLAIN });
    expect(updateMisconceptions(lesson, demoA.misconceptions, r)).toEqual([]);
  });

  it("choosing the M2 distractor keeps M2", () => {
    const r = scoreExitTicket(lesson, { choices: { ...ALL_RIGHT, e2: "a" }, explanation: GOOD_EXPLAIN });
    expect(updateMisconceptions(lesson, demoA.misconceptions, r)).toEqual(["M2"]);
  });
});
