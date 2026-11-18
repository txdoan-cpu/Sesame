import { llmConfigured, llmGenerate } from "@/lib/llm";
import {
  LEAK_FALLBACK,
  MATH_FALLBACK,
  PARSE_FALLBACK,
  equationsInText,
  leaksExitAnswer,
  trimWords,
  verifyMath,
} from "@/lib/llm/guard";
import { ASK_SYSTEM_PROMPT, buildAskPayload, parseModelJson, type AskTurn } from "@/lib/llm/prompts";
import { screenQuestion, type SafetyCategory } from "@/lib/llm/safety";
import type { Lesson, Slide } from "@/lib/lesson/schema";

/**
 * Answers one learner question about the current slide (CLAUDE.md §7.2).
 * No database access here: the caller loads context and saves results.
 */

export type AskContext = {
  lesson: Lesson;
  slideNo: number;
  outcome: { code: string; description: string };
  indicators: { code: string; description: string }[];
  misconceptions: { code: string; description: string }[];
  learner: { reading_level: string | null; interests: string[]; misconceptions: string[] };
  history: AskTurn[];
  question: string;
};

export type AskOutcome =
  | { kind: "safety"; category: SafetyCategory }
  | {
      kind: "answer";
      answer: string;
      checkQuestion: string;
      indicator: string | null;
      misconception: string | null;
      /** Why a safe fallback replaced the model text, if it did. */
      fallback: "math" | "leak" | "parse" | null;
      failures: string[];
      provider: string;
    }
  | { kind: "error"; code: "ai_not_connected" | "rate_limited" | "unavailable" };

/** Equations in x that appear on a slide (visuals, check-ins, body text). */
export function slideEquations(slide: Slide): string[] {
  const out: string[] = [];
  const v = slide.visual;
  if (v.type === "steps") out.push(...v.lines);
  if (v.type === "compare") out.push(v.equation);
  if (v.type === "balance") out.push(`${v.left} = ${v.right}`);
  if (v.type === "tiles") out.push(`${v.groups}(x + ${v.units_per_group}) = ${v.right_units}`);
  for (const item of slide.checkpoint?.items ?? []) if (item.kind === "numeric" && item.equation) out.push(item.equation);
  for (const m of slide.body_md.matchAll(/\$([^$]+)\$/g)) if (m[1].includes("=") && m[1].includes("x")) out.push(m[1]);
  return out;
}

export function exitItems(lesson: Lesson): { equation: string; answer: number }[] {
  return lesson.exit_ticket.choice.flatMap((q) => {
    const correct = q.options.find((o) => o.correct);
    return q.equation && correct?.value !== undefined ? [{ equation: q.equation, answer: correct.value }] : [];
  });
}

function plain(md: string): string {
  return md.replace(/\\\$/g, "$").replace(/\$([^$]+)\$/g, "$1").replace(/\*\*/g, "");
}

export async function answerQuestion(ctx: AskContext): Promise<AskOutcome> {
  const screen = screenQuestion(ctx.question);
  if (screen.flagged && screen.category) return { kind: "safety", category: screen.category };

  if (!llmConfigured()) return { kind: "error", code: "ai_not_connected" };

  const slide = ctx.lesson.slides.find((s) => s.no === ctx.slideNo) ?? ctx.lesson.slides[0];
  const exits = exitItems(ctx.lesson);

  const result = await llmGenerate({
    system: ASK_SYSTEM_PROMPT,
    user: buildAskPayload({
      outcome: ctx.outcome,
      indicators: ctx.indicators,
      misconceptions: ctx.misconceptions,
      slide: { no: slide.no, title: slide.title, body: plain(slide.body_md), narration: slide.narration, indicators: slide.indicators },
      learner: ctx.learner,
      history: ctx.history,
      question: ctx.question,
      exitTicketEquations: exits.map((e) => e.equation),
    }),
    maxTokens: 400,
    json: true,
    timeoutMs: 25_000,
  });

  if (!result.ok) {
    if (result.code === "missing_key") return { kind: "error", code: "ai_not_connected" };
    if (result.code === "rate_limited") return { kind: "error", code: "rate_limited" };
    return { kind: "error", code: "unavailable" };
  }

  const out = parseModelJson(result.text);
  const base = { kind: "answer" as const, provider: result.provider };
  if (!out) {
    return { ...base, answer: PARSE_FALLBACK, checkQuestion: "", indicator: null, misconception: null, fallback: "parse", failures: ["unparseable model output"] };
  }
  if (out.safety_concern) return { kind: "safety", category: "other_concern" };

  const indicator = out.indicator && ctx.indicators.some((i) => i.code === out.indicator) ? out.indicator : null;
  const misconception = out.misconception && ctx.misconceptions.some((m) => m.code === out.misconception) ? out.misconception : null;

  if (leaksExitAnswer(out, exits)) {
    return { ...base, answer: LEAK_FALLBACK, checkQuestion: "What would you do first, to both sides?", indicator, misconception, fallback: "leak", failures: ["exit-ticket answer"] };
  }

  const context = [...slideEquations(slide), ...equationsInText(ctx.question)];
  const math = verifyMath(out, context);
  if (!math.ok) {
    return { ...base, answer: MATH_FALLBACK, checkQuestion: "What is the first step on the slide?", indicator, misconception, fallback: "math", failures: math.failures };
  }

  return {
    ...base,
    answer: trimWords(out.answer, 100),
    checkQuestion: trimWords(out.check_question, 30),
    indicator,
    misconception,
    fallback: null,
    failures: [],
  };
}
