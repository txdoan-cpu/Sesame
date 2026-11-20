import { paceFor } from "@/lib/learner/pace";
import { describe, expect, it } from "vitest";
import raw from "@/content/lessons/8PR2-demo-A.json";
import { LessonSchema, type CheckItem, type NumericItem } from "@/lib/lesson/schema";
import { expressionEquals, satisfies, splitEquation } from "@/lib/math/check";

// Appendix B: "Every equation and answer in this lesson must pass lib/math/check.ts
// (substitution) in a unit test."

const lesson = LessonSchema.parse(raw);
const numericItems: NumericItem[] = [
  ...lesson.diagnostic,
  ...lesson.slides.flatMap((s) => (s.checkpoint?.items ?? []).filter((i: CheckItem): i is NumericItem => i.kind === "numeric")),
];

describe("lesson 8PR2-demo-A structure", () => {
  it("has 9 slides numbered 1–9, for outcome 8PR2", () => {
    expect(lesson.outcome_code).toBe("8PR2");
    expect(lesson.slides.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("slide text does not just repeat the narration", () => {
    for (const s of lesson.slides) {
      expect(s.narration.length, `slide ${s.no}`).toBeGreaterThan(40);
      expect(s.body_md.trim(), `slide ${s.no}`).not.toBe(s.narration.trim());
      expect(s.narration.includes(s.body_md.trim()), `slide ${s.no}`).toBe(false);
    }
  });

  it("has a check-in on most slides (about every 2–3 minutes)", () => {
    const withCheck = lesson.slides.filter((s) => s.checkpoint).map((s) => s.no);
    expect(withCheck).toEqual([1, 2, 4, 5, 6, 7, 8]);
    // No more than one slide in a row without a check-in before the exit ticket.
    for (let n = 1; n < 9; n++) expect(withCheck.includes(n) || withCheck.includes(n + 1), `slides ${n}-${n + 1}`).toBe(true);
  });

  it("practice items start with the Appendix B ones, all with tiered hints", () => {
    const practice = lesson.slides[7].checkpoint!.items as NumericItem[];
    expect(practice.slice(0, 3).map((p) => [p.equation, p.answer])).toEqual([
      ["2x + 9 = 1", -4],
      ["x/3 + 4 = 6", 6],
      ["4(x - 2) = 12", 5],
    ]);
    for (const p of practice) expect(p.hints.length).toBe(3);
  });

  it("every check-in and diagnostic item names the skill it updates (learner model)", () => {
    const items = [...lesson.slides.flatMap((s) => s.checkpoint?.items ?? []), ...lesson.diagnostic];
    for (const i of items) expect(i.skill, i.id).toMatch(/^8(N|PR|SS|SP)\d+\.[a-z_]+$/);
  });

  it("practice sets follow the pace table (low end of each range; fast adds 1 transfer task)", () => {
    const cp = lesson.slides[7].checkpoint!;
    for (const level of ["slow", "medium", "fast"] as const) {
      const pace = paceFor(level);
      const ids = cp.pacing![level];
      expect(ids.length, level).toBe(pace.practiceItems[0] + pace.transferItems);
      expect(new Set(ids).size, level).toBe(ids.length);
    }
    expect(cp.pacing!.fast).toContain("s8t");
  });
});

describe("every equation and answer passes substitution", () => {
  it.each(numericItems.map((i) => [i.id, i] as const))("check-in %s", (_id, item) => {
    expect(item.equation || item.expression, "item needs an equation or expression").toBeTruthy();
    if (item.equation) expect(satisfies(item.equation, item.answer)).toBe(true);
    if (item.expression) expect(expressionEquals(item.expression, item.answer)).toBe(true);
  });

  it.each(lesson.slides.filter((s) => s.visual.type === "steps").map((s) => [s.no, s] as const))(
    "worked steps on slide %s",
    (_no, slide) => {
      if (slide.visual.type !== "steps") return;
      for (const line of slide.visual.lines) expect(satisfies(line, slide.visual.solution), line).toBe(true);
      if (slide.visual.check) {
        const { left, right } = splitEquation(slide.visual.check);
        expect(expressionEquals(left, Number(right))).toBe(true);
      }
    },
  );

  it("slide 2 balance shows a true equation for its scale", () => {
    const v = lesson.slides[1].visual;
    expect(v.type).toBe("balance");
    if (v.type === "balance") expect(satisfies(`${v.left} = ${v.right}`, 3)).toBe(true);
  });

  it("slide 5 tiles match 2(x + 3) = 14 → 2x + 6 = 14, x = 4", () => {
    const v = lesson.slides[4].visual;
    expect(v.type).toBe("tiles");
    if (v.type !== "tiles") return;
    const eq = `${v.groups}(x + ${v.units_per_group}) = ${v.right_units}`;
    expect(eq).toBe("2(x + 3) = 14");
    expect(satisfies(eq, 4)).toBe(true);
    expect(satisfies("2x + 6 = 14", 4)).toBe(true);
  });

  it("slide 6: Maya's work is right and Liam's (M2) is wrong", () => {
    const v = lesson.slides[5].visual;
    if (v.type !== "compare") throw new Error("slide 6 must be a compare visual");
    const [maya, liam] = v.people;
    expect(satisfies(v.equation, maya.answer)).toBe(true);
    for (const line of maya.lines) expect(satisfies(line, maya.answer), line).toBe(true);
    expect(satisfies(v.equation, liam.answer)).toBe(false);
    // Liam's later lines follow from his wrong first line.
    for (const line of liam.lines) expect(satisfies(line, liam.answer), line).toBe(true);
  });
});

describe("exit ticket", () => {
  const { choice, explain, mastery_threshold } = lesson.exit_ticket;

  it("has 3 tap items + 1 explain item, threshold 80%", () => {
    expect(choice).toHaveLength(3);
    expect(explain.prompt.length).toBeGreaterThan(10);
    expect(mastery_threshold).toBe(0.8);
  });

  it("each wrong option maps to a misconception M1–M5, and all five are covered", () => {
    const seen = new Set<string>();
    for (const q of choice) {
      for (const o of q.options) {
        if (o.correct) continue;
        expect(o.misconception, `${q.id}/${o.id}`).toMatch(/^M[1-5]$/);
        seen.add(o.misconception!);
      }
    }
    expect([...seen].sort()).toEqual(["M1", "M2", "M3", "M4", "M5"]);
  });

  it("numeric options: the correct one solves the equation, distractors do not", () => {
    for (const q of choice.filter((c) => c.equation)) {
      for (const o of q.options) {
        expect(o.value, `${q.id}/${o.id} needs a value`).toBeTypeOf("number");
        expect(satisfies(q.equation!, o.value!), `${q.id}/${o.id}`).toBe(o.correct);
      }
    }
  });
});
