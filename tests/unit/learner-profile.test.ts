import { describe, expect, it } from "vitest";
import demoA from "@/content/profiles/demo-A.json";
import {
  LearnerProfileSchema,
  needsDiagnostic,
  outcomeMastery,
  statusForMastery,
  toLearnerProfileRow,
} from "@/lib/learner-profile";

describe("learner profile contract (§9)", () => {
  it("demo-A matches the schema", () => {
    const p = LearnerProfileSchema.parse(demoA);
    expect(p.target_outcome).toBe("8PR2");
    expect(p.misconceptions).toEqual(["M2", "M3"]);
    expect(p.interests).toContain("hockey");
  });

  it("rejects bad shapes", () => {
    expect(LearnerProfileSchema.safeParse({ ...demoA, confidence_of_estimate: 1.5 }).success).toBe(false);
    expect(LearnerProfileSchema.safeParse({ ...demoA, misconceptions: ["X9"] }).success).toBe(false);
    expect(LearnerProfileSchema.safeParse({ ...demoA, mastery: { "8PR2.two_step": 2 } }).success).toBe(false);
  });

  it("starts with diagnostic questions only when confidence < 0.6", () => {
    expect(needsDiagnostic({ confidence_of_estimate: 0.7 })).toBe(false);
    expect(needsDiagnostic({ confidence_of_estimate: 0.6 })).toBe(false);
    expect(needsDiagnostic({ confidence_of_estimate: 0.59 })).toBe(true);
  });

  it("maps to a database row with the account uuid", () => {
    const row = toLearnerProfileRow(LearnerProfileSchema.parse(demoA), "00000000-0000-0000-0000-000000000001");
    expect(row.learner_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(row.confidence).toBe(0.7);
  });
});

describe("outcome status thresholds (§6)", () => {
  it.each([
    [null, "not_started"],
    [0, "learning"],
    [0.59, "learning"],
    [0.6, "nearly"],
    [0.79, "nearly"],
    [0.8, "achieved"],
    [1, "achieved"],
  ] as const)("mastery %s -> %s", (m, s) => {
    expect(statusForMastery(m)).toBe(s);
  });

  it("averages sub-skills per outcome for demo-A", () => {
    const m = outcomeMastery(LearnerProfileSchema.parse(demoA).mastery);
    expect(m).toEqual({ "8PR2": 0.5, "8N7": 0.7 });
  });
});
