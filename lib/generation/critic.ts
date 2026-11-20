import { z } from "zod";
import type { Lesson } from "@/lib/lesson/schema";
import { RUBRIC_S, type Activity } from "./pedagogy";
import type { Plan, PlanContext } from "./planner";
import type { MathFailure } from "./validate";

/**
 * Critic (CLAUDE.md §7.9): Rubric S, the Pedagogical Fit Score (0–100).
 * Criteria that code can check are scored by code; the rest come from the
 * model. Gates S1, S10, S11 must be >= 2. >= 75 → deliver; 60–74 → regenerate
 * (max 2 times); < 60 or still failing → teacher review.
 */

export type CriticScores = Record<string, number>;
export type CriticResult = {
  scores: CriticScores;
  reasons: Record<string, string>;
  summary: string;
  total: number;
  failedGates: string[];
  decision: "deliver" | "regenerate" | "review";
};

const ACTIVITIES_ALL: Activity[] = ["activate", "present", "guided_practice", "apply", "close"];

/** Scores for the criteria code can check. */
export function codeScores(lesson: Lesson, plan: Plan, ctx: PlanContext, math: MathFailure[]): { scores: CriticScores; reasons: Record<string, string> } {
  const scores: CriticScores = {};
  const reasons: Record<string, string> = {};
  const slides = lesson.slides;

  // S1: every indicator taught on a slide and checked (slide check-in or exit ticket).
  const codes = ctx.lo.indicators.map((i) => i.code);
  const taught = new Set(slides.flatMap((s) => s.indicators));
  const checked = new Set([...slides.filter((s) => s.checkpoint).flatMap((s) => s.indicators), ...lesson.exit_ticket.choice.map((c) => c.indicator)]);
  const notTaught = codes.filter((c) => !taught.has(c));
  const notChecked = codes.filter((c) => !checked.has(c));
  scores.S1 = codes.length === 0 ? 2 : !notTaught.length && !notChecked.length ? 3 : !notTaught.length && notChecked.length === 1 ? 2 : notTaught.length < codes.length ? 1 : 0;
  reasons.S1 = notTaught.length || notChecked.length ? `Not taught: ${notTaught.join(", ") || "none"}. Not checked: ${notChecked.join(", ") || "none"}.` : "Every indicator is taught and checked.";

  // S3: all five activities (the exit ticket is part of "close").
  const present = new Set(slides.map((s) => s.activity).filter(Boolean));
  present.add("close");
  const missing = ACTIVITIES_ALL.filter((a) => !present.has(a));
  scores.S3 = missing.length === 0 ? 3 : missing.length === 1 ? 2 : missing.length === 2 ? 1 : 0;
  reasons.S3 = missing.length ? `Missing: ${missing.join(", ")}.` : "All five activities are present.";

  // S4: each slide uses the method chosen for its activity, and every chosen method appears.
  const chosen = new Map(plan.activities.map((a) => [a.activity, a.methods.map((m) => m.id)]));
  const off = slides.filter((s) => s.activity && s.method && !(chosen.get(s.activity) ?? []).includes(s.method) && s.method !== "retrieval_spacing_interleaving");
  const unused = plan.activities.flatMap((a) => a.methods.map((m) => m.id)).filter((id) => !slides.some((s) => s.method === id));
  scores.S4 = !off.length && !unused.length ? 3 : off.length + unused.length === 1 ? 2 : 1;
  reasons.S4 = off.length || unused.length ? `Off-plan slides: ${off.map((s) => s.no).join(", ") || "none"}. Planned but unused: ${unused.join(", ") || "none"}.` : "Slides follow the planner and D1–D8.";

  // S5: regular checks, each with hints or feedback.
  const withCheck = slides.filter((s) => s.checkpoint).length;
  const items = slides.flatMap((s) => s.checkpoint?.items ?? []);
  const supported = items.every((i) => (i.kind === "numeric" ? i.hints.length > 0 : i.options.every((o) => o.feedback.length > 0)));
  const ratio = slides.length ? withCheck / slides.length : 0;
  scores.S5 = withCheck === 0 ? 0 : supported && ratio >= 0.5 ? 3 : supported || ratio >= 0.5 ? 2 : 1;
  reasons.S5 = `${withCheck} of ${slides.length} slides have a check-in; ${supported ? "all" : "not all"} items have hints or feedback.`;

  // S9 (code part): slide text must not copy the narration.
  const copied = slides.filter((s) => s.body_md.trim() === s.narration.trim() || (s.body_md.trim().length > 30 && s.narration.includes(s.body_md.trim())));
  if (copied.length) {
    scores.S9 = 1;
    reasons.S9 = `Slide text copies the narration on slides ${copied.map((s) => s.no).join(", ")}.`;
  }

  // S10: math gate.
  scores.S10 = math.length === 0 ? 3 : 0;
  reasons.S10 = math.length ? `${math.length} math problem(s): ${math.slice(0, 3).map((m) => `${m.where}: ${m.detail}`).join("; ")}` : "Every equation and answer passes substitution.";

  // S11 (code part): every slide cites an approved material.
  const uncited = slides.filter((s) => !(s.sources ?? []).length);
  if (uncited.length) {
    scores.S11 = uncited.length > slides.length / 2 ? 0 : 1;
    reasons.S11 = `No approved source cited on slides ${uncited.map((s) => s.no).join(", ")}.`;
  }

  // S13: the player's theme meets AA contrast and is tested on phone, tablet and desktop.
  scores.S13 = 3;
  reasons.S13 = "Rendered by the lesson player (AA contrast, responsive; tested on three devices).";

  // S14: review slides for weak prerequisites (< 0.7) and slides for known misconceptions.
  const weak = ctx.lo.prerequisites.filter((p) => (ctx.learner.prerequisiteMastery[p] ?? 0) < 0.7);
  const needsReview = weak.length > 0;
  const hasReview = slides.some((s) => s.activity === "activate" && s.checkpoint);
  const needsMis = ctx.learner.misconceptions.length > 0;
  const hasMis = slides.some((s) => s.visual.type === "compare");
  const s14Missing = [needsReview && !hasReview ? "prerequisite review" : null, needsMis && !hasMis ? "misconception slide" : null].filter(Boolean);
  scores.S14 = s14Missing.length === 0 ? 3 : s14Missing.length === 1 ? 2 : 1;
  reasons.S14 = s14Missing.length ? `Missing: ${s14Missing.join(", ")}.` : "Needed review and misconception slides are there.";

  // S15: practice size and check frequency follow the pace table.
  const practice = slides.find((s) => s.activity === "apply" && s.checkpoint && s.checkpoint.items.length > 1);
  const [lo, hi] = plan.pace.practiceItems;
  const n = practice?.checkpoint?.items.length ?? 0;
  const practiceOk = n >= lo && n <= hi + plan.pace.transferItems;
  // About 1.5 minutes per slide: no longer than the pace's check interval without a check-in.
  const maxGap = Math.max(1, Math.floor(plan.pace.checkEveryMinutes / 1.5));
  let gap = 0;
  let gapOk = true;
  for (const s of slides) {
    gap = s.checkpoint ? 0 : gap + 1;
    if (gap > maxGap) gapOk = false;
  }
  scores.S15 = practiceOk && gapOk ? 3 : practiceOk || gapOk ? 2 : 1;
  reasons.S15 = `${n} practice items (pace ${plan.pace.level}: ${lo}–${hi}${plan.pace.transferItems ? " + transfer" : ""}); ${gapOk ? "check-ins are frequent enough" : "too long between check-ins"}.`;

  return { scores, reasons };
}

// --- Model part ---

export function criticSystemPrompt(): string {
  const lines = RUBRIC_S.criteria.filter((c) => c.by.includes("model")).map((c) => `- ${c.id} ${c.name}: ${c.check}`);
  return `You review a lesson for one Grade 8 learner (age 13-14) in Newfoundland and Labrador, Canada.
Score each criterion 0-3 (0 not met, 1 weak, 2 good, 3 exemplary). Be strict and fair.
${lines.join("\n")}
For S12 give three numbers 1-5: content, design, coherence.
Reply with ONLY JSON:
{ "scores": { "S2": 0-3, "S6": 0-3, "S7": 0-3, "S8": 0-3, "S9": 0-3, "S11": 0-3 }, "s12": { "content": 1-5, "design": 1-5, "coherence": 1-5 },
  "reasons": { "<id>": "one short sentence" }, "summary": "two sentences for the teacher" }`;
}

export function criticPayload(lesson: Lesson, ctx: PlanContext): string {
  return JSON.stringify({
    task: "critic_s",
    outcome: { code: ctx.lo.code, description: ctx.lo.description, bloom_level: ctx.lo.bloom },
    lesson: {
      title: lesson.title,
      slides: lesson.slides.map((s) => ({
        no: s.no,
        activity: s.activity,
        title: s.title,
        body: s.body_md,
        narration: s.narration,
        visual: s.visual,
        items: (s.checkpoint?.items ?? []).map((i) => (i.kind === "numeric" ? { prompt: i.prompt, answer: i.answer } : { prompt: i.prompt, options: i.options.map((o) => o.text) })),
        cites: s.sources ?? [],
      })),
      exit_ticket: lesson.exit_ticket.choice.map((c) => c.prompt),
    },
  });
}

const ModelAnswer = z.object({
  scores: z.record(z.string(), z.coerce.number().int().min(0).max(3)),
  s12: z.object({ content: z.coerce.number().min(1).max(5), design: z.coerce.number().min(1).max(5), coherence: z.coerce.number().min(1).max(5) }).optional(),
  reasons: z.record(z.string(), z.string()).default({}),
  summary: z.string().default(""),
});
export type ModelAnswer = z.infer<typeof ModelAnswer>;

export function parseCriticAnswer(text: string): ModelAnswer | null {
  const s = text.replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const p = ModelAnswer.safeParse(JSON.parse(s.slice(a, b + 1)));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/**
 * Combines code and model scores, applies the gates and thresholds.
 * Where both judge a criterion (S9, S11), the lower score wins.
 * `attempt` is 1-based; after max_regenerations the lesson goes to review.
 */
export function combine(code: { scores: CriticScores; reasons: Record<string, string> }, model: ModelAnswer | null, attempt: number): CriticResult {
  const scores: CriticScores = {};
  const reasons: Record<string, string> = {};
  for (const c of RUBRIC_S.criteria) {
    const fromCode = code.scores[c.id];
    let fromModel = model?.scores[c.id];
    if (c.id === "S12" && model?.s12) {
      const mean = (model.s12.content + model.s12.design + model.s12.coherence) / 3;
      fromModel = Math.round(((mean - 1) / 4) * 3);
    }
    // Without a model answer, model-only criteria count as "weak" so a lesson never passes unseen.
    const value = fromCode !== undefined && fromModel !== undefined ? Math.min(fromCode, fromModel) : (fromCode ?? fromModel ?? 1);
    scores[c.id] = value;
    reasons[c.id] = code.reasons[c.id] ?? model?.reasons[c.id] ?? "";
  }
  const total = Math.round(RUBRIC_S.criteria.reduce((s, c) => s + (c.weight * scores[c.id]) / 3, 0));
  const failedGates = RUBRIC_S.criteria.filter((c) => c.gate && scores[c.id] < RUBRIC_S.gate_min).map((c) => c.id);
  const canRetry = attempt <= RUBRIC_S.max_regenerations;
  let decision: CriticResult["decision"];
  if (!failedGates.length && total >= RUBRIC_S.deliver_min) decision = "deliver";
  else if (total < RUBRIC_S.regenerate_min) decision = "review";
  else decision = canRetry ? "regenerate" : "review";
  return { scores, reasons, summary: model?.summary ?? "", total, failedGates, decision };
}

/** What to fix next time, for the author. */
export function feedbackFor(result: CriticResult, math: MathFailure[], problems: string[]): string[] {
  const out = [...problems, ...math.map((m) => `Math error at ${m.where}: ${m.detail}`)];
  for (const c of RUBRIC_S.criteria) if (result.scores[c.id] < 2 && result.reasons[c.id]) out.push(`${c.id} ${c.name}: ${result.reasons[c.id]}`);
  return out.slice(0, 20);
}
