import type { Lesson } from "./schema";
import { statusForMastery, type OutcomeStatusKind } from "@/lib/learner-profile";

/** Learner's exit-ticket submission. */
export type ExitAnswers = {
  choices: Record<string, string>; // item id -> option id
  explanation: string;
};

export type ItemResult = {
  item: string;
  indicator: string;
  skill: string;
  chosen: string | null;
  correct: boolean;
  misconception: string | null;
};

export type ExitScore = {
  score: number; // fraction of choice items correct, 0..1
  correctCount: number;
  total: number;
  explainedBalance: boolean;
  mastered: boolean;
  items: ItemResult[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** True when the explanation mentions keeping the equation balanced (§7.1, Appendix B). */
export function explainsBalance(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => {
    try {
      return new RegExp(k, "i").test(t);
    } catch {
      return t.includes(k.toLowerCase());
    }
  });
}

export function scoreExitTicket(lesson: Lesson, answers: ExitAnswers): ExitScore {
  const items: ItemResult[] = lesson.exit_ticket.choice.map((q) => {
    const chosenId = answers.choices[q.id] ?? null;
    const option = q.options.find((o) => o.id === chosenId) ?? null;
    return {
      item: q.id,
      indicator: q.indicator,
      skill: q.skill,
      chosen: option?.id ?? null,
      correct: option?.correct ?? false,
      misconception: option && !option.correct ? (option.misconception ?? null) : null,
    };
  });
  const correctCount = items.filter((i) => i.correct).length;
  const score = round2(correctCount / items.length);
  const explainedBalance = explainsBalance(answers.explanation, lesson.exit_ticket.explain.keywords);
  return {
    score,
    correctCount,
    total: items.length,
    explainedBalance,
    mastered: score >= lesson.exit_ticket.mastery_threshold && explainedBalance,
    items,
  };
}

export type PreviousStatus = {
  status: OutcomeStatusKind;
  achieved_at: string | null;
  retained_at: string | null;
} | null;

export type NextStatus = {
  status: OutcomeStatusKind;
  mastery: number;
  achieved_at: string | null;
  retained_at: string | null;
};

const RETENTION_DAYS = 14;

/**
 * Outcome status after an exit ticket (§6 thresholds):
 * achieved needs score >= threshold AND the "keep it balanced" explanation;
 * retained needs a second mastered result >= 14 days after achieved_at.
 * A good score without the explanation stays at most "nearly".
 */
export function nextOutcomeStatus(prev: PreviousStatus, result: ExitScore, now: Date): NextStatus {
  const nowIso = now.toISOString();
  const mastery = result.score;

  if (result.mastered) {
    if (prev?.achieved_at) {
      const days = (now.getTime() - new Date(prev.achieved_at).getTime()) / 86_400_000;
      if (days >= RETENTION_DAYS) {
        return { status: "retained", mastery, achieved_at: prev.achieved_at, retained_at: prev.retained_at ?? nowIso };
      }
      return {
        status: prev.status === "retained" ? "retained" : "achieved",
        mastery,
        achieved_at: prev.achieved_at,
        retained_at: prev.retained_at,
      };
    }
    return { status: "achieved", mastery, achieved_at: nowIso, retained_at: null };
  }

  const status = statusForMastery(Math.min(mastery, 0.79));
  // Keep the dates of an earlier achievement; the status reflects today's result.
  return { status, mastery, achieved_at: prev?.achieved_at ?? null, retained_at: prev?.retained_at ?? null };
}

/**
 * Updates learner_profiles.misconceptions from exit-ticket results. Sub-skill
 * mastery comes from the learner model (BKT, lib/learner/model.ts) since Round 9.
 * A misconception is added when chosen, and cleared when an item that offered
 * it as a distractor was answered correctly (and it was not chosen elsewhere).
 */
export function updateMisconceptions(lesson: Lesson, previous: string[], result: ExitScore): string[] {
  const chosen = new Set(result.items.flatMap((i) => (i.misconception ? [i.misconception] : [])));
  const cleared = new Set<string>();
  for (const item of result.items) {
    if (!item.correct) continue;
    const q = lesson.exit_ticket.choice.find((c) => c.id === item.item);
    for (const o of q?.options ?? []) if (o.misconception && !chosen.has(o.misconception)) cleared.add(o.misconception);
  }
  return [...new Set([...previous.filter((m) => !cleared.has(m)), ...chosen])].sort();
}
