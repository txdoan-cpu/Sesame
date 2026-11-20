import type { LearningRateLevel } from "@/lib/learner/bkt";
import { paceFor, type Pace } from "@/lib/learner/pace";
import {
  ACTIVITIES,
  CITATIONS,
  METHODS,
  RUBRIC_T,
  RULES,
  methodById,
  type Activity,
  type Method,
  type Rule,
  type Template,
} from "./pedagogy";

/**
 * Planner (CLAUDE.md §7.9, Appendix C): split the lesson into activities,
 * filter methods with D1–D8, score the rest with Rubric T × evidence weight,
 * pick the best per activity, then lay out the slides the Content Author fills.
 * Pure: no I/O, no model calls.
 */

export type PlanContext = {
  lo: {
    code: string;
    description: string;
    knowledgeType: "procedural" | "conceptual" | null;
    bloom: string | null;
    indicators: { code: string; description: string }[];
    misconceptions: { code: string; description: string }[];
    prerequisites: string[];
  };
  learner: {
    /** Mean mastery of the LO's prerequisites; null when the LO lists none. */
    readiness: number | null;
    /** Current mastery of this LO (mean of its skills; 0 when new). */
    loMastery: number;
    /** The learner's misconceptions that belong to this LO. */
    misconceptions: string[];
    pace: LearningRateLevel;
    /** Mastery per prerequisite (skill id or outcome code). */
    prerequisiteMastery: Record<string, number>;
    confidence: number;
  };
};

export type TBreakdown = Record<string, number>;
export type ScoredMethod = { id: string; name: string; score: number; evidence: string; t: TBreakdown };

export type ActivityPlan = {
  activity: Activity;
  methods: { id: string; name: string; reason: string; score: number; evidence: string; citations: { id: string; text: string }[] }[];
  /** Other methods that were allowed, best first (for the rationale card). */
  alternatives: ScoredMethod[];
};

export type SlideSpec = {
  id: string;
  activity: Activity;
  method: string;
  template: Template;
  indicators: string[];
  /** Number of check-in items the slide should have (0 = none). */
  items: number;
  /** For "Who's right?": the misconception the wrong solution shows. */
  misconception?: string;
  /** For prerequisite review: which prerequisites to revisit. */
  prerequisites?: string[];
  /** For practice in fast pace: one item is a real-life transfer task. */
  transfer?: boolean;
  /** For worked examples: 1-based example number. */
  example?: number;
};

export type Plan = {
  flags: { readiness: number | null; loMastery: number; hasMisconceptions: boolean; newSymbolic: boolean; weakPrerequisites: string[] };
  rulesApplied: { id: string; text: string }[];
  excluded: { id: string; name: string; why: string }[];
  activities: ActivityPlan[];
  pace: Pace;
  slides: SlideSpec[];
  needsDiagnostic: boolean;
  reviewAfterDays: number[] | null;
};

const inRange = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
const distance = (v: number, [lo, hi]: readonly [number, number]) => (v < lo ? lo - v : v > hi ? v - hi : 0);

/** Rubric T for one method and this learner (each criterion 0–3). */
export function rubricT(m: Method, ctx: PlanContext): TBreakdown {
  const { lo, learner } = ctx;
  const kt = !lo.knowledgeType || m.knowledge_types.includes(lo.knowledgeType);
  const bl = !lo.bloom || m.bloom.length === 0 || m.bloom.includes(lo.bloom);
  const readiness = learner.readiness ?? learner.loMastery;
  const rOk = inRange(readiness, m.readiness);
  const mOk = inRange(learner.loMastery, m.mastery);
  const near = Math.max(distance(readiness, m.readiness), distance(learner.loMastery, m.mastery)) <= 0.1;
  return {
    T1: kt && bl ? 3 : kt || bl ? 2 : 1,
    T2: rOk && mOk ? 3 : rOk || mOk ? 2 : near ? 1 : 0,
    T3: m.pace.includes(learner.pace) ? 3 : 1,
    T4: learner.misconceptions.length ? (m.addresses_misconceptions ? 3 : 1) : 2,
    T5: RUBRIC_T.icap_scores[m.icap] ?? 0,
    T6: m.one_to_one ? 3 : 0,
    T7: m.feedback ? 3 : 1,
  };
}

/** Score(m) = evidence_weight(m) × Σ w_i·T_i(m) / 3, on 0–100. */
export function scoreMethod(m: Method, ctx: PlanContext): ScoredMethod {
  const t = rubricT(m, ctx);
  const sum = RUBRIC_T.criteria.reduce((s, c) => s + c.weight * (t[c.id] ?? 0), 0) / 3;
  const score = Math.round(METHODS.evidence_weights[m.evidence] * sum * 10) / 10;
  return { id: m.id, name: m.name, score, evidence: m.evidence, t };
}

function ruleApplies(r: Rule, f: Plan["flags"]): boolean {
  const w = r.when;
  if (w.readiness_lt !== undefined && !(f.readiness !== null && f.readiness < w.readiness_lt)) return false;
  if (w.mastery_gte !== undefined && !(f.loMastery >= w.mastery_gte)) return false;
  if (w.has_misconceptions && !f.hasMisconceptions) return false;
  if (w.new_symbolic && !f.newSymbolic) return false;
  if (w.weak_prerequisites && f.weakPrerequisites.length === 0) return false;
  return true;
}

/** Order inside an activity: concrete before worked examples (D4 then D1). */
const SEQUENCE = ["concreteness_fading", "direct_instruction_worked_examples", "guided_discovery", "faded_examples", "compare_solutions_incorrect_examples"];
const seqIndex = (id: string) => {
  const i = SEQUENCE.indexOf(id);
  return i < 0 ? SEQUENCE.length : i;
};

const cite = (m: Method) => m.citations.map((id) => ({ id, text: CITATIONS.get(id) ?? id }));

export function planLesson(ctx: PlanContext): Plan {
  const pace = paceFor(ctx.learner.pace);
  const weakPrerequisites = ctx.lo.prerequisites.filter((p) => (ctx.learner.prerequisiteMastery[p] ?? 0) < 0.8);
  const flags: Plan["flags"] = {
    readiness: ctx.learner.readiness,
    loMastery: ctx.learner.loMastery,
    hasMisconceptions: ctx.learner.misconceptions.length > 0,
    newSymbolic: ctx.learner.loMastery < 0.3,
    weakPrerequisites,
  };
  const active = RULES.filter((r) => ruleApplies(r, flags));

  // Hard filters.
  const excluded: Plan["excluded"] = [];
  const excludedIds = new Set<string>();
  const drop = (m: Method, why: string) => {
    if (excludedIds.has(m.id)) return;
    excludedIds.add(m.id);
    excluded.push({ id: m.id, name: m.name, why });
  };
  for (const m of METHODS.methods) {
    if (m.cross_cutting) continue;
    if (!m.one_to_one) drop(m, "School channel only; this is 1:1 home study.");
    for (const r of active) {
      if (r.exclude?.includes(m.id)) drop(m, `${r.id}: ${r.text}`);
      if (r.exclude_icap?.includes(m.icap)) drop(m, `${r.id}: ${r.text}`);
      if (r.exclude_evidence?.includes(m.evidence)) drop(m, `${r.id}: ${r.text}`);
    }
  }
  const allowed = METHODS.methods.filter((m) => !m.cross_cutting && !excludedIds.has(m.id));
  const preferIcap = active.find((r) => r.prefer_icap)?.prefer_icap;

  // Requirements per activity from the rules.
  const required = new Map<Activity, { id: string; rule: Rule }[]>();
  const addReq = (a: Activity, id: string, rule: Rule) => {
    if (excludedIds.has(id)) return; // an exclusion from another rule wins
    const list = required.get(a) ?? [];
    if (!list.some((x) => x.id === id)) list.push({ id, rule });
    required.set(a, list);
  };
  for (const r of active) for (const [a, id] of Object.entries(r.require ?? {})) addReq(a as Activity, id, r);
  for (const r of active) {
    if (!r.require_somewhere) continue;
    const slot = r.require_somewhere.activities.find((a) => !(required.get(a)?.length)) ?? r.require_somewhere.activities[0];
    addReq(slot, r.require_somewhere.method, r);
  }

  const activities: ActivityPlan[] = ACTIVITIES.map((activity) => {
    const scored = allowed
      .filter((m) => m.activities.includes(activity))
      .map((m) => scoreMethod(m, ctx))
      .sort((a, b) => b.score - a.score || Number(methodById(b.id).icap === preferIcap) - Number(methodById(a.id).icap === preferIcap) || a.id.localeCompare(b.id));
    const req = (required.get(activity) ?? []).sort((a, b) => seqIndex(a.id) - seqIndex(b.id));
    const chosen = req.length
      ? req.map(({ id, rule }) => {
          const m = methodById(id);
          const s = scored.find((x) => x.id === id) ?? scoreMethod(m, ctx);
          return { id, name: m.name, reason: `Required by ${rule.id}: ${rule.text}`, score: s.score, evidence: m.evidence, citations: cite(m) };
        })
      : scored.slice(0, 1).map((s) => {
          const m = methodById(s.id);
          return { id: s.id, name: m.name, reason: "Highest Rubric T score × evidence weight for this learner.", score: s.score, evidence: m.evidence, citations: cite(m) };
        });
    return { activity, methods: chosen, alternatives: scored.filter((s) => !chosen.some((c) => c.id === s.id)).slice(0, 3) };
  });

  return {
    flags,
    rulesApplied: active.map((r) => ({ id: r.id, text: r.text })),
    excluded,
    activities,
    pace,
    slides: layoutSlides(activities, ctx, pace, flags),
    needsDiagnostic: ctx.learner.confidence < 0.6,
    reviewAfterDays: active.some((r) => r.spaced_review) ? pace.reviewAfterDays : null,
  };
}

/** Turns the chosen methods into slide specs; spreads indicators so each one is taught and checked. */
function layoutSlides(activities: ActivityPlan[], ctx: PlanContext, pace: Pace, flags: Plan["flags"]): SlideSpec[] {
  const specs: Omit<SlideSpec, "id" | "indicators">[] = [];
  const misconception = ctx.learner.misconceptions[0] ?? ctx.lo.misconceptions[0]?.code;
  for (const a of activities) {
    for (const m of a.methods) {
      const method = methodById(m.id);
      switch (method.template) {
        case "retrieval":
          if (a.activity === "activate") {
            specs.push({ activity: a.activity, method: m.id, template: "retrieval", items: 2, prerequisites: flags.weakPrerequisites.length ? flags.weakPrerequisites : ctx.lo.prerequisites });
          } else {
            specs.push({ activity: a.activity, method: m.id, template: "retrieval", items: 2 });
          }
          break;
        case "worked_example": {
          const n = Math.max(1, Math.min(3, pace.workedExamplesBeforeFading));
          for (let i = 1; i <= n; i++) specs.push({ activity: a.activity, method: m.id, template: "worked_example", items: 0, example: i });
          break;
        }
        case "cpa":
          specs.push({ activity: a.activity, method: m.id, template: "cpa", items: 1 });
          break;
        case "faded_example":
          specs.push({ activity: a.activity, method: m.id, template: "faded_example", items: 1 });
          break;
        case "whos_right":
          specs.push({ activity: a.activity, method: m.id, template: "whos_right", items: 1, misconception });
          break;
        case "discovery":
          specs.push({ activity: a.activity, method: m.id, template: "discovery", items: 1 });
          break;
        case "transfer":
          specs.push({ activity: a.activity, method: m.id, template: "transfer", items: 1 });
          break;
        case "self_explain":
          specs.push({ activity: a.activity, method: m.id, template: a.activity === "close" ? "close" : "self_explain", items: 1 });
          break;
        default:
          break;
      }
    }
    // Supported practice in "apply", sized by the pace table (§7.8).
    if (a.activity === "apply") {
      const transfer = pace.transferItems > 0 && !a.methods.some((m) => m.id === "problem_solving_transfer");
      specs.push({ activity: "apply", method: a.methods[0]?.id ?? "retrieval_spacing_interleaving", template: "practice", items: pace.practiceItems[0] + (transfer ? 1 : 0), transfer });
    }
  }
  // A closing slide always leads into the exit ticket.
  if (!specs.some((s) => s.activity === "close")) {
    const close = activities.find((a) => a.activity === "close")?.methods[0]?.id ?? "self_explanation";
    specs.push({ activity: "close", method: close, template: "close", items: 1 });
  }

  // Indicators: teaching slides (present / guided practice) round-robin, every check gets one too.
  const codes = ctx.lo.indicators.map((i) => i.code);
  const teaching = specs.filter((s) => s.activity === "present" || s.activity === "guided_practice");
  const assigned = specs.map(() => [] as string[]);
  if (codes.length) {
    const teach = teaching.length ? teaching : specs;
    codes.forEach((c, i) => assigned[specs.indexOf(teach[i % teach.length])].push(c));
    let k = 0;
    specs.forEach((s, i) => {
      if (s.items > 0 && s.template !== "retrieval") {
        const c = codes[k++ % codes.length];
        if (!assigned[i].includes(c)) assigned[i].push(c);
      }
    });
  }
  return specs.map((s, i) => ({ ...s, id: `g${i + 1}`, indicators: assigned[i] }));
}
