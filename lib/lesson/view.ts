import "server-only";
import type { LearningRateLevel } from "@/lib/learner/bkt";
import type { CheckItem, Lesson, NumericItem, Slide, Visual } from "./schema";
import { blockHtml, inlineHtml, mathHtml, plainText } from "./render";

/**
 * What the browser gets: pre-rendered HTML, and no exit-ticket answer key
 * (exit tickets are scored on the server). Checkpoint answers are included
 * so practice feedback is instant; they are not graded.
 */

export type NumericItemView = {
  kind: "numeric";
  id: string;
  promptHtml: string;
  promptText: string;
  answer: number;
  hints: string[];
  correctFeedback: string;
};

export type ChoiceItemView = {
  kind: "choice";
  id: string;
  promptHtml: string;
  promptText: string;
  options: { id: string; text: string; correct: boolean; feedback: string }[];
};

export type CheckItemView = NumericItemView | ChoiceItemView;

export type VisualView =
  | { type: "none" }
  | { type: "balance"; leftHtml: string; rightHtml: string; tilt: "left" | "right" | null }
  | { type: "tiles"; groups: number; unitsPerGroup: number; rightUnits: number }
  | { type: "steps"; linesHtml: string[]; hiddenLine: number | null; checkHtml: string | null }
  | { type: "compare"; equationHtml: string; people: { name: string; linesHtml: string[] }[] };

export type SlideView = {
  no: number;
  title: string;
  bodyHtml: string;
  narration: string;
  visual: VisualView;
  checkpoint: CheckItemView[] | null;
};

export type ExitView = {
  choice: { id: string; promptHtml: string; options: { id: string; text: string }[] }[];
  explainPrompt: string;
};

export type LessonView = {
  id: string;
  title: string;
  slides: SlideView[];
  diagnostic: NumericItemView[];
  exit: ExitView;
};

function numericView(item: NumericItem): NumericItemView {
  return {
    kind: "numeric",
    id: item.id,
    promptHtml: inlineHtml(item.prompt),
    promptText: plainText(item.prompt),
    answer: item.answer,
    hints: item.hints,
    correctFeedback: item.correct_feedback,
  };
}

function checkView(item: CheckItem): CheckItemView {
  if (item.kind === "numeric") return numericView(item);
  return {
    kind: "choice",
    id: item.id,
    promptHtml: inlineHtml(item.prompt),
    promptText: plainText(item.prompt),
    options: item.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct, feedback: o.feedback })),
  };
}

function visualView(v: Visual): VisualView {
  switch (v.type) {
    case "none":
      return { type: "none" };
    case "balance":
      return { type: "balance", leftHtml: mathHtml(v.left), rightHtml: mathHtml(v.right), tilt: v.tilt ?? null };
    case "tiles":
      return { type: "tiles", groups: v.groups, unitsPerGroup: v.units_per_group, rightUnits: v.right_units };
    case "steps":
      return {
        type: "steps",
        linesHtml: v.lines.map(mathHtml),
        hiddenLine: v.hidden_line ?? null,
        checkHtml: v.check ? mathHtml(v.check) : null,
      };
    case "compare":
      return {
        type: "compare",
        equationHtml: mathHtml(v.equation),
        people: v.people.map((p) => ({ name: p.name, linesHtml: p.lines.map(mathHtml) })),
      };
  }
}

/** The check-in items a learner at this pace sees (§7.8 automatic pacing); every item if the slide has no pacing. */
export function pacedItems(checkpoint: NonNullable<Slide["checkpoint"]>, level: LearningRateLevel | null): CheckItem[] {
  const ids = level ? checkpoint.pacing?.[level] : undefined;
  if (!ids) return checkpoint.items;
  return ids.map((id) => checkpoint.items.find((i) => i.id === id)).filter((i): i is CheckItem => Boolean(i));
}

export function toLessonView(lesson: Lesson, level: LearningRateLevel | null = null): LessonView {
  return {
    id: lesson.id,
    title: lesson.title,
    slides: lesson.slides.map((s) => ({
      no: s.no,
      title: s.title,
      bodyHtml: blockHtml(s.body_md),
      narration: s.narration,
      visual: visualView(s.visual),
      checkpoint: s.checkpoint ? pacedItems(s.checkpoint, level).map(checkView) : null,
    })),
    diagnostic: lesson.diagnostic.map(numericView),
    exit: {
      choice: lesson.exit_ticket.choice.map((q) => ({
        id: q.id,
        promptHtml: inlineHtml(q.prompt),
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
      })),
      explainPrompt: lesson.exit_ticket.explain.prompt,
    },
  };
}
