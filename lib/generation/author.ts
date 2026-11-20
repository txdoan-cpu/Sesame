import { z } from "zod";
import { LessonSchema, type Lesson } from "@/lib/lesson/schema";
import type { Plan, PlanContext, SlideSpec } from "./planner";

/**
 * Content Author (CLAUDE.md §7.9): fills slide templates from APPROVED
 * materials only. The model returns JSON; this module builds the prompt,
 * parses the answer defensively and assembles a lesson the player can run.
 */

export type SourceMaterial = { ref: string; id: string; title: string; sourceUrl: string | null; licence: string; excerpt: string };

export type AuthorInput = {
  plan: Plan;
  ctx: PlanContext;
  materials: SourceMaterial[];
  skills: string[];
  learner: { readingLevel: string; interests: string[] };
  /** Problems from the previous attempt or a teacher's notes, to fix this time. */
  feedback: string[];
};

const TEMPLATE_GUIDE: Record<SlideSpec["template"], string> = {
  retrieval: "Quick recall of earlier skills. visual {type:'none'}. items: numeric questions.",
  cpa: "Concrete first: a balance scale. visual {type:'balance', left:'x + 3', right:'7'} (an equation in x). items: one numeric item solving that equation.",
  worked_example: "A fully worked example. visual {type:'steps', lines:['3x + 4 = 19','3x = 15','x = 5'], solution:5, check:'3(5) + 4 = 19'}. Every line must be true for x = solution. No items.",
  faded_example: "Same as a worked example but one step is hidden for the learner: visual {type:'steps', lines:[...], solution, hidden_line: index of the hidden line}. items: one numeric item whose equation is lines[0] and answer is the solution.",
  whos_right: "Two students solve the same equation; one is right, one makes the given misconception. visual {type:'compare', equation:'2(x + 3) = 14', people:[{name, lines:[...], answer}, {name, lines:[...], answer}]}. items: one choice item 'Who is right?' with options for each person; the wrong option has misconception = the given code.",
  discovery: "A guided question that lets the learner notice the rule. visual {type:'none'} or a balance. items: numeric.",
  practice: "Supported practice. visual {type:'none'}. items: numeric equations, easiest first, each with 3 hints from gentle to almost-the-answer. If transfer is true, the last item is a short real-life word problem (equation still in x).",
  transfer: "One real-life problem that needs the skill in a new situation. visual {type:'none'}. items: one numeric word problem with equation in x.",
  self_explain: "Ask the learner to explain why a step works. visual {type:'none'}. items: one choice item with 3 reasons, one correct, each with feedback.",
  close: "Sum up the key idea in one or two sentences and lead into the last questions. items: one choice item checking the key idea.",
};

export function authorSystemPrompt(): string {
  return `You write short lesson slides for one Grade 8 learner in St. John's, Newfoundland and Labrador, Canada.
Rules:
- Canadian English. Short sentences, plain words, at the learner's reading level. Warm and encouraging.
- Use ONLY the approved materials given (cite them by ref, e.g. "m1"). Every slide lists the refs it used in "sources". Do not invent facts that are not in the materials or basic arithmetic.
- Narration is what the voice says. Slide text (body_md) must NOT copy the narration word for word; keep slide text short (1-3 lines).
- Math is plain ASCII with x as the variable: "3x + 4 = 19", "x/3 + 4 = 6", "2(x + 3) = 14". Use small integers. Inside body_md or prompts, wrap math in $...$. Never write a dollar amount with "$"; write "dollars".
- Every numeric item has "equation" (an equation in x whose ONLY solution is "answer") or "expression" (no x, equal to "answer").
- Use the learner's interests for contexts when it fits. Never mention the learner's mistakes, scores or feelings directly.
- One idea per slide. Exactly the slides asked for, in the same order, with the same "spec" ids.
- Each slide has EXACTLY the number of items given in its "items" field (0 means no items).
- The exit ticket has EXACTLY 3 choice items, and "diagnostic" has EXACTLY 3 numeric items.
- Keep the JSON compact: no extra fields, no comments.
Reply with ONLY a JSON object, no other text:
{
  "title": "lesson title",
  "slides": [ { "spec": "g1", "title": "...", "body_md": "...", "narration": "...", "visual": {...}, "items": [ ... ], "sources": ["m1"] } ],
  "diagnostic": [ three numeric items on the prerequisites ],
  "exit_ticket": {
    "choice": [ three items: { "prompt": "...", "equation": "...", "indicator": "<indicator code>", "skill": "<skill id>",
                "options": [ { "text": "x = 5", "value": 5, "correct": true }, { "text": "x = 6.5", "value": 6.5, "correct": false, "misconception": "<code>" } ] } ],
    "explain": { "prompt": "In your own words: ...", "keywords": ["regex", "fragments", "that show understanding"] }
  }
}
Numeric item: { "kind": "numeric", "prompt": "Solve $2x + 9 = 1$", "equation": "2x + 9 = 1", "answer": -4, "hints": ["gentle", "more", "almost the answer"], "correct_feedback": "Yes! ...", "skill": "<skill id>" }
Choice item: { "kind": "choice", "prompt": "...", "options": [ { "text": "...", "correct": true, "feedback": "..." }, { "text": "...", "correct": false, "feedback": "...", "misconception": "<code>" } ], "skill": "<skill id>" }
Exit-ticket options: 3 or 4 per item, exactly one correct; every wrong option has a "value" (when there is an equation) and a misconception code from the list.`;
}

export function authorPayload(input: AuthorInput): string {
  const { plan, ctx, materials, skills, learner } = input;
  return JSON.stringify({
    task: "author_lesson",
    outcome: {
      code: ctx.lo.code,
      description: ctx.lo.description,
      bloom_level: ctx.lo.bloom,
      knowledge_type: ctx.lo.knowledgeType,
      indicators: ctx.lo.indicators,
      misconceptions: ctx.lo.misconceptions,
      prerequisites: ctx.lo.prerequisites,
    },
    learner: { reading_level: learner.readingLevel, interests: learner.interests, pace: plan.pace.level },
    skills,
    materials: materials.map((m) => ({ ref: m.ref, title: m.title, licence: m.licence, text: m.excerpt })),
    slides: plan.slides.map((s) => ({
      spec: s.id,
      activity: s.activity,
      method: s.method,
      template: s.template,
      how: TEMPLATE_GUIDE[s.template],
      items: s.items,
      indicators: s.indicators,
      misconception: s.misconception ?? null,
      prerequisites: s.prerequisites ?? null,
      transfer: s.transfer ?? false,
      example: s.example ?? null,
    })),
    fix_these_problems: input.feedback,
  });
}

// --- Parsing the model's answer (lenient; the lesson schema is strict afterwards) ---

const Num = z.coerce.number();
const NumericOut = z.object({
  kind: z.literal("numeric").default("numeric"),
  prompt: z.string(),
  equation: z.string().optional(),
  expression: z.string().optional(),
  answer: Num,
  hints: z.array(z.string()).default([]),
  correct_feedback: z.string().default("Yes! Well done."),
  skill: z.string().optional(),
});
const ChoiceOut = z.object({
  kind: z.literal("choice"),
  prompt: z.string(),
  options: z.array(z.object({ text: z.string(), correct: z.boolean(), feedback: z.string().default(""), misconception: z.string().optional() })).min(2),
  skill: z.string().optional(),
});
const ItemOut = z.union([ChoiceOut, NumericOut]);
const VisualOut = z.union([
  z.object({ type: z.literal("steps"), lines: z.array(z.string()).min(1), solution: Num, hidden_line: z.coerce.number().int().optional(), check: z.string().optional() }),
  z.object({ type: z.literal("compare"), equation: z.string(), people: z.array(z.object({ name: z.string(), lines: z.array(z.string()).min(1), answer: Num })).length(2) }),
  z.object({ type: z.literal("balance"), left: z.string(), right: z.string() }),
  z.object({ type: z.literal("none") }),
]);
const SlideOut = z.object({
  spec: z.string(),
  title: z.string(),
  body_md: z.string(),
  narration: z.string(),
  visual: VisualOut.optional(),
  items: z.array(ItemOut).default([]),
  sources: z.array(z.string()).default([]),
});
export const AuthorOutSchema = z.object({
  title: z.string(),
  slides: z.array(SlideOut).min(1),
  diagnostic: z.array(NumericOut).default([]),
  exit_ticket: z.object({
    choice: z
      .array(
        z.object({
          prompt: z.string(),
          equation: z.string().optional(),
          indicator: z.string().optional(),
          skill: z.string().optional(),
          options: z.array(z.object({ text: z.string(), value: Num.optional(), correct: z.boolean(), misconception: z.string().optional() })).min(3),
        }),
      )
      .min(3),
    explain: z.object({ prompt: z.string(), keywords: z.array(z.string()).min(1) }),
  }),
});
export type AuthorOut = z.infer<typeof AuthorOutSchema>;

/** Strips code fences and chatter, then validates. Returns the reason on failure. */
export function parseAuthorAnswer(text: string): { ok: true; value: AuthorOut } | { ok: false; error: string } {
  const s = text.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The author's answer had no JSON." };
  try {
    const parsed = AuthorOutSchema.safeParse(JSON.parse(s.slice(start, end + 1)));
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, error: `The author's JSON did not match the template: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  } catch {
    return { ok: false, error: "The author's answer was not valid JSON." };
  }
}

// --- Assembly ---

const letters = "abcdefghij";

export type AssembleResult = { ok: true; lesson: Lesson; problems: string[] } | { ok: false; error: string };

/**
 * Builds a player-ready lesson from the plan and the author's answer. The plan
 * decides order, activities, methods and indicators; the author only supplies
 * words, numbers and visuals. Problems that can be repaired are listed for the critic.
 */
export function assembleLesson(id: string, input: AuthorInput, out: AuthorOut): AssembleResult {
  const { plan, ctx, materials, skills } = input;
  const problems: string[] = [];
  const refs = new Map(materials.map((m) => [m.ref, m.id]));
  const mis = ctx.lo.misconceptions.map((m) => m.code);
  const skill = (s: string | undefined) => (s && skills.includes(s) ? s : skills[0]);
  const misCode = (c: string | undefined) => (c && mis.includes(c) ? c : mis[0]);

  const slides = plan.slides.map((spec, i) => {
    const no = i + 1;
    const o = out.slides.find((s) => s.spec === spec.id) ?? out.slides[i];
    if (!o) {
      problems.push(`slide ${no} (${spec.template}) is missing`);
      return null;
    }
    let visual: Lesson["slides"][number]["visual"] = { type: "none" };
    const v = o.visual;
    const want = { worked_example: "steps", faded_example: "steps", whos_right: "compare", cpa: "balance" }[spec.template as string];
    if (want && v?.type !== want) problems.push(`slide ${no} (${spec.template}) needs a ${want} visual`);
    if (v?.type === "steps") {
      const hidden = spec.template === "faded_example" ? (v.hidden_line ?? 1) : undefined;
      visual = { type: "steps", lines: v.lines, solution: v.solution, ...(hidden !== undefined ? { hidden_line: Math.min(hidden, v.lines.length - 1) } : {}), ...(v.check ? { check: v.check } : {}) };
    } else if (v?.type === "compare") {
      visual = { type: "compare", equation: v.equation, people: [v.people[0], v.people[1]] };
    } else if (v?.type === "balance") {
      visual = { type: "balance", left: v.left, right: v.right };
    }
    const items = o.items.slice(0, Math.max(spec.items, 0)).map((it, k) => {
      const itemId = `s${no}${letters[k]}`;
      if (it.kind === "choice") {
        const options = it.options.map((op, j) => ({
          id: letters[j],
          text: op.text,
          correct: op.correct,
          feedback: op.feedback || (op.correct ? "Yes, that's it." : "Not quite. Look again."),
          ...(op.correct ? {} : { misconception: misCode(op.misconception) }),
        }));
        return { kind: "choice" as const, id: itemId, prompt: it.prompt, skill: skill(it.skill), options };
      }
      const hints = it.hints.length ? it.hints.slice(0, 3) : ["Do the same thing to both sides."];
      return {
        kind: "numeric" as const,
        id: itemId,
        prompt: it.prompt,
        skill: skill(it.skill),
        ...(it.equation ? { equation: it.equation } : {}),
        ...(it.expression ? { expression: it.expression } : {}),
        answer: it.answer,
        hints,
        correct_feedback: it.correct_feedback,
      };
    });
    if (items.length < spec.items) problems.push(`slide ${no} (${spec.template}) has ${items.length} of ${spec.items} check items`);
    const sources = o.sources.map((r) => refs.get(r)).filter((x): x is string => Boolean(x));
    return {
      no,
      title: o.title,
      body_md: o.body_md,
      narration: o.narration,
      visual,
      ...(items.length ? { checkpoint: { items } } : {}),
      indicators: spec.indicators,
      activity: spec.activity,
      method: spec.method,
      sources,
    };
  });
  if (slides.some((s) => s === null)) return { ok: false, error: problems.join("; ") };

  const codes = ctx.lo.indicators.map((x) => x.code);
  const diagnostic = out.diagnostic.slice(0, 4).map((d, k) => ({
    kind: "numeric" as const,
    id: `d${k + 1}`,
    prompt: d.prompt,
    skill: skill(d.skill),
    ...(d.equation ? { equation: d.equation } : {}),
    ...(d.expression ? { expression: d.expression } : {}),
    answer: d.answer,
    hints: d.hints.length ? d.hints.slice(0, 3) : ["Do the same thing to both sides."],
    correct_feedback: d.correct_feedback,
  }));
  const choice = out.exit_ticket.choice.slice(0, 3).map((q, k) => ({
    id: `e${k + 1}`,
    prompt: q.prompt,
    ...(q.equation ? { equation: q.equation } : {}),
    indicator: q.indicator && codes.includes(q.indicator) ? q.indicator : (codes[k % Math.max(codes.length, 1)] ?? "LO"),
    skill: skill(q.skill),
    options: q.options.slice(0, 4).map((op, j) => ({
      id: letters[j],
      text: op.text,
      ...(op.value !== undefined ? { value: op.value } : {}),
      correct: op.correct,
      ...(op.correct ? {} : { misconception: misCode(op.misconception) }),
    })),
  }));

  const candidate = {
    id,
    outcome_code: ctx.lo.code,
    title: out.title,
    minutes: Math.max(5, Math.round(slides.length * 1.5 + 3)),
    slides,
    diagnostic,
    exit_ticket: { choice, explain: out.exit_ticket.explain, mastery_threshold: 0.8 },
  };
  const parsed = LessonSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: `Lesson does not fit the player: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, lesson: parsed.data, problems };
}
