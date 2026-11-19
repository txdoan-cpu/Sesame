import { z } from "zod";
import raw from "@/content/pedagogy/rubric_r.json";

/**
 * Rubric R for reference materials (CLAUDE.md §7.7, Appendix C). The rubric
 * itself is data in content/pedagogy/rubric_r.json; this module only scores.
 */

export const RubricSchema = z.object({
  id: z.string(),
  title: z.string(),
  scale: z.string(),
  select_rule: z.string(),
  gate_min: z.number(),
  select_min_weighted_mean: z.number(),
  criteria: z
    .array(z.object({ id: z.string(), gate: z.boolean(), weight: z.number().positive(), name: z.string(), check: z.string() }))
    .min(1),
});

export type Rubric = z.infer<typeof RubricSchema>;

export const RUBRIC_R: Rubric = RubricSchema.parse(raw);

/** What the model returns: a 0–3 score and a short reason per criterion. */
export const RubricAnswerSchema = z.object({
  scores: z.record(z.string(), z.coerce.number().int().min(0).max(3)),
  reasons: z.record(z.string(), z.string()).default({}),
  summary: z.string().default(""),
});

export type RubricAnswer = z.infer<typeof RubricAnswerSchema>;

export type RubricResult = {
  scores: Record<string, number>;
  reasons: Record<string, string>;
  summary: string;
  /** Weighted mean on the 0–3 scale. */
  weightedMean: number;
  /** Same, scaled to 0–100 for display. */
  percent: number;
  failedGates: string[];
  decision: "approved" | "rejected";
  /** Plain-language reasons for a rejection. */
  rejectReasons: string[];
};

/** Scores every criterion (missing ones count as 0) and applies the gates and the 2.0 threshold. */
export function scoreRubric(answer: RubricAnswer, rubric: Rubric = RUBRIC_R): RubricResult {
  const scores: Record<string, number> = {};
  let total = 0;
  let weights = 0;
  for (const c of rubric.criteria) {
    const s = answer.scores[c.id] ?? 0;
    scores[c.id] = s;
    total += c.weight * s;
    weights += c.weight;
  }
  const weightedMean = Math.round((total / weights) * 100) / 100;
  const failedGates = rubric.criteria.filter((c) => c.gate && scores[c.id] < rubric.gate_min).map((c) => c.id);
  const rejectReasons = [
    ...failedGates.map((id) => {
      const c = rubric.criteria.find((x) => x.id === id)!;
      return `${id} ${c.name}: ${scores[id]}/3 (gate needs ${rubric.gate_min})${answer.reasons[id] ? ` - ${answer.reasons[id]}` : ""}`;
    }),
    ...(weightedMean < rubric.select_min_weighted_mean
      ? [`Weighted mean ${weightedMean.toFixed(2)}/3 is below ${rubric.select_min_weighted_mean.toFixed(1)}`]
      : []),
  ];
  return {
    scores,
    reasons: Object.fromEntries(rubric.criteria.map((c) => [c.id, answer.reasons[c.id] ?? ""])),
    summary: answer.summary,
    weightedMean,
    percent: Math.round((weightedMean / 3) * 100),
    failedGates,
    decision: rejectReasons.length === 0 ? "approved" : "rejected",
    rejectReasons,
  };
}

/** System prompt for the reviewer model, built from the rubric data. */
export function rubricSystemPrompt(rubric: Rubric = RUBRIC_R): string {
  const lines = rubric.criteria.map((c) => `- ${c.id}${c.gate ? " [gate]" : ""} ${c.name} (${c.weight}%): ${c.check}`);
  return `You review reference materials that a teacher uploaded for lessons in a Canadian school curriculum.
Score the material against each criterion. ${rubric.scale}
Be strict and fair. Judge only what is in the material and its stated source and licence.
If the text is cut short, judge what you can see.

Criteria:
${lines.join("\n")}

Reply with ONLY a JSON object, no other text:
{
  "scores": { ${rubric.criteria.map((c) => `"${c.id}": 0-3`).join(", ")} },
  "reasons": { "<criterion id>": "one short sentence" },
  "summary": "one or two sentences for the teacher"
}`;
}

/** The user message: the material and the outcomes it is linked to. Text is trimmed to keep calls small. */
export function rubricPayload(input: {
  material: { title: string; sourceUrl: string | null; licence: string; licenceNote: string | null; text: string };
  outcomes: { code: string; description: string; bloomLevel: string | null; knowledgeType: string | null; prerequisites: string[] }[];
}): string {
  return JSON.stringify({
    task: "rubric_r",
    outcomes: input.outcomes,
    material: {
      title: input.material.title,
      source_url: input.material.sourceUrl,
      licence: input.material.licence,
      licence_note: input.material.licenceNote,
      text: input.material.text.slice(0, 12_000),
      text_truncated: input.material.text.length > 12_000,
    },
  });
}

/** Strips code fences and chatter, then validates. Never throws. */
export function parseRubricAnswer(text: string): RubricAnswer | null {
  const s = text.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = RubricAnswerSchema.safeParse(JSON.parse(s.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
