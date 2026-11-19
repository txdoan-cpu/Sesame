import { z } from "zod";

/**
 * Pre-authored lesson format (CLAUDE.md §7.1, Appendix B).
 * Math is written in plain ASCII ("3x + 4 = 19") so lib/math/check.ts can
 * verify it and the renderer can turn it into KaTeX.
 */

const MisconceptionCode = z.string().regex(/^M\d+$/);
const IndicatorCode = z.string().regex(/^PR\d+\.\d+$/);

/** A typed or spoken numeric answer. `equation` (if given) must be satisfied by `answer`. */
export const NumericItemSchema = z.object({
  kind: z.literal("numeric"),
  id: z.string(),
  prompt: z.string(),
  /** Equation in x that `answer` solves, checked by substitution. */
  equation: z.string().optional(),
  /** Expression with no variables whose value is `answer` (e.g. "-3(5) + 5"). */
  expression: z.string().optional(),
  answer: z.number(),
  /** Tiered hints, gentlest first. */
  hints: z.array(z.string()).min(1),
  correct_feedback: z.string(),
});

/** Tap one option. */
export const ChoiceItemSchema = z
  .object({
    kind: z.literal("choice"),
    id: z.string(),
    prompt: z.string(),
    options: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          correct: z.boolean(),
          feedback: z.string(),
          misconception: MisconceptionCode.optional(),
        }),
      )
      .min(2),
  })
  .refine((c) => c.options.filter((o) => o.correct).length === 1, "exactly one correct option");

export const CheckItemSchema = z.union([NumericItemSchema, ChoiceItemSchema]);

export const VisualSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("balance"),
    left: z.string(),
    right: z.string(),
    tilt: z.enum(["left", "right"]).optional(),
  }),
  z.object({
    type: z.literal("tiles"),
    /** a(x + b) = c drawn as `groups` rows of [x][1]×units, against `right_units` 1-tiles. */
    groups: z.number().int().min(1),
    units_per_group: z.number().int().min(0),
    right_units: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("steps"),
    /** Each line is an equation; all must be satisfied by `solution` (checked in tests). */
    lines: z.array(z.string()).min(1),
    solution: z.number(),
    /** Index of a line hidden for the learner to fill in (faded example). */
    hidden_line: z.number().int().optional(),
    check: z.string().optional(),
  }),
  z.object({
    type: z.literal("compare"),
    equation: z.string(),
    people: z
      .array(z.object({ name: z.string(), lines: z.array(z.string()).min(1), answer: z.number() }))
      .length(2),
  }),
]);

export const SlideSchema = z.object({
  no: z.number().int().min(1),
  title: z.string(),
  body_md: z.string(),
  narration: z.string(),
  visual: VisualSchema,
  checkpoint: z.object({ items: z.array(CheckItemSchema).min(1) }).optional(),
  indicators: z.array(IndicatorCode).default([]),
});

export const ExitChoiceSchema = z
  .object({
    id: z.string(),
    prompt: z.string(),
    equation: z.string().optional(),
    indicator: IndicatorCode,
    /** learner_profiles.mastery key this item updates, e.g. "8PR2.two_step". */
    skill: z.string().regex(/^8(N|PR|SS|SP)\d+\.[a-z_]+$/),
    options: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          value: z.number().optional(),
          correct: z.boolean(),
          misconception: MisconceptionCode.optional(),
        }),
      )
      .min(3),
  })
  .refine((q) => q.options.filter((o) => o.correct).length === 1, "exactly one correct option")
  .refine((q) => q.options.every((o) => o.correct || o.misconception), "every wrong option maps to a misconception");

export const LessonSchema = z.object({
  id: z.string(),
  outcome_code: z.string(),
  title: z.string(),
  minutes: z.number().int(),
  slides: z.array(SlideSchema).min(1),
  diagnostic: z.array(NumericItemSchema).min(3).max(4),
  exit_ticket: z.object({
    choice: z.array(ExitChoiceSchema).length(3),
    explain: z.object({
      prompt: z.string(),
      /** Regex sources; matching any one means the learner explained "keep it balanced". */
      keywords: z.array(z.string()).min(1),
    }),
    mastery_threshold: z.number().min(0).max(1),
  }),
  rationale: z
    .object({
      /** 0–3 per criterion (proposal, Solution 1). Self-assessed by the author for the demo. */
      criteria_scores: z.record(z.enum(["A1", "A2", "B1", "B2", "B3", "B4", "C1", "D1", "E1"]), z.number().int().min(0).max(3)),
      gate_passed: z.boolean(),
      rows: z.array(
        z.object({
          /** Sharing item the reason is based on; the row is hidden when the learner keeps it private. */
          requires: z.enum(["outcome_status", "misconceptions"]).nullable(),
          criteria: z.array(z.enum(["A1", "A2", "B1", "B2", "B3", "B4", "C1", "D1", "E1"])).min(1),
          signal_en: z.string(),
          signal_vi: z.string(),
          method_en: z.string(),
          method_vi: z.string(),
        }),
      ),
    })
    .optional(),
});

export type Lesson = z.infer<typeof LessonSchema>;
export type LessonRationale = NonNullable<Lesson["rationale"]>;
export type Slide = z.infer<typeof SlideSchema>;
export type CheckItem = z.infer<typeof CheckItemSchema>;
export type NumericItem = z.infer<typeof NumericItemSchema>;
export type ChoiceItem = z.infer<typeof ChoiceItemSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type ExitChoice = z.infer<typeof ExitChoiceSchema>;
