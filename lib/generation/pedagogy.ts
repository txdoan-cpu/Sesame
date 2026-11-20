import { z } from "zod";
import citationsRaw from "@/content/pedagogy/citations.json";
import methodsRaw from "@/content/pedagogy/methods.json";
import rubricSRaw from "@/content/pedagogy/rubric_s.json";
import rubricTRaw from "@/content/pedagogy/rubric_t.json";
import rulesRaw from "@/content/pedagogy/rules.json";

/** Appendix C as data (content/pedagogy/*.json), validated once at load. */

export const ACTIVITIES = ["activate", "present", "guided_practice", "apply", "close"] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const TEMPLATES = [
  "retrieval",
  "cpa",
  "worked_example",
  "faded_example",
  "whos_right",
  "discovery",
  "practice",
  "transfer",
  "self_explain",
  "close",
] as const;
export type Template = (typeof TEMPLATES)[number];

const Range = z.tuple([z.number(), z.number()]);
const Evidence = z.enum(["A", "B", "C", "excluded"]);
const Icap = z.enum(["passive", "active", "constructive", "interactive"]);

export const MethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  fits_when: z.string(),
  avoid_when: z.string(),
  evidence: Evidence,
  citations: z.array(z.string()),
  activities: z.array(z.enum(ACTIVITIES)),
  cross_cutting: z.boolean().optional(),
  knowledge_types: z.array(z.enum(["procedural", "conceptual"])),
  bloom: z.array(z.string()),
  readiness: Range,
  mastery: Range,
  pace: z.array(z.enum(["slow", "medium", "fast"])),
  addresses_misconceptions: z.boolean(),
  icap: Icap,
  feedback: z.boolean(),
  one_to_one: z.boolean(),
  template: z.enum(TEMPLATES).nullable(),
});
export type Method = z.infer<typeof MethodSchema>;

export const METHODS = z
  .object({ evidence_weights: z.record(Evidence, z.number()), activities: z.array(z.enum(ACTIVITIES)), methods: z.array(MethodSchema).min(1) })
  .parse(methodsRaw);

const RuleSchema = z.object({
  id: z.string(),
  text: z.string(),
  when: z.object({
    readiness_lt: z.number().optional(),
    mastery_gte: z.number().optional(),
    has_misconceptions: z.boolean().optional(),
    new_symbolic: z.boolean().optional(),
    weak_prerequisites: z.boolean().optional(),
  }),
  exclude: z.array(z.string()).optional(),
  require: z.partialRecord(z.enum(ACTIVITIES), z.string()).optional(),
  require_somewhere: z.object({ method: z.string(), activities: z.array(z.enum(ACTIVITIES)) }).optional(),
  exclude_icap: z.array(Icap).optional(),
  prefer_icap: Icap.optional(),
  exclude_evidence: z.array(Evidence).optional(),
  spaced_review: z.boolean().optional(),
  prerequisite_review: z.boolean().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;
export const RULES = z.object({ rules: z.array(RuleSchema).length(8) }).parse(rulesRaw).rules;

export const RUBRIC_T = z
  .object({
    criteria: z.array(z.object({ id: z.string(), weight: z.number(), name: z.string() })).length(7),
    icap_scores: z.record(Icap, z.number()),
  })
  .parse(rubricTRaw);

export const RUBRIC_S = z
  .object({
    gate_min: z.number(),
    deliver_min: z.number(),
    regenerate_min: z.number(),
    max_regenerations: z.number().int(),
    criteria: z
      .array(z.object({ id: z.string(), gate: z.boolean(), weight: z.number(), name: z.string(), check: z.string(), by: z.string() }))
      .length(15),
  })
  .parse(rubricSRaw);

export const CITATIONS = new Map(
  z
    .object({ references: z.array(z.object({ id: z.string(), text: z.string() })) })
    .parse(citationsRaw)
    .references.map((r) => [r.id, r.text]),
);

export function methodById(id: string): Method {
  const m = METHODS.methods.find((x) => x.id === id);
  if (!m) throw new Error(`unknown method ${id}`);
  return m;
}
