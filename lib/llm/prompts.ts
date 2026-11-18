import { z } from "zod";

/**
 * Prompts for /api/ask (CLAUDE.md §7.2). Pure functions so they can be tested.
 * The learner's question goes in a JSON payload, never into the system prompt.
 */

export const ASK_SYSTEM_PROMPT = `You are a warm, patient math tutor for a Grade 8 student in St. John's, Newfoundland and Labrador, Canada.
The student is in the middle of a lesson and pressed the "ask a question" button. You get a JSON payload with the current slide, the lesson outcome and indicators, a short learner profile, up to 3 earlier questions and answers, and the new question.

How to answer:
- Answer about the current slide and step. Use what is on the slide.
- At most 80 words. Short sentences. Plain words a Grade 6 reader knows. Canadian English spelling.
- Be warm and encouraging. Never make the student feel silly.
- If the student says they do not get it, or seems lost, switch the representation (a balance scale, or algebra tiles) and break the step into smaller steps.
- Use the student's interests only when it makes the math clearer, and at most once. Prefer the slide's own example.
- Do not use nicknames like "buddy" or "champ".
- Never give the final answer to any equation listed in "exit_ticket_equations". Give a hint about the next step instead.
- If the question is off-topic, answer in one kind sentence, then bring the student back to the lesson.
- End with one short check question to see if they understood.
- Do not write math in LaTeX. Write equations in plain text, like 3x + 4 = 19.
- If the question suggests the student may be unsafe, hurt, bullied, abused, or thinking about self-harm, set "safety_concern" to true and keep "answer" short and kind.

Reply with ONLY a JSON object, no other text:
{
  "answer": string,                 // your reply, at most 80 words, without the check question
  "check_question": string,         // one short question to check understanding
  "indicator": string | null,       // best matching indicator code, e.g. "PR2.3", or null
  "misconception": string | null,   // best matching misconception code, e.g. "M2", or null
  "math_claims": [ { "equation": string, "x": number } ],  // every value of x you state, with the equation it solves
  "safety_concern": boolean
}`;

export type AskTurn = { question: string; answer: string };

export type AskPayloadInput = {
  outcome: { code: string; description: string };
  indicators: { code: string; description: string }[];
  misconceptions: { code: string; description: string }[];
  slide: { no: number; title: string; body: string; narration: string; indicators: string[] };
  learner: { reading_level: string | null; interests: string[]; misconceptions: string[] };
  history: AskTurn[];
  question: string;
  exitTicketEquations: string[];
};

/** Builds the user message. Only the last 3 turns are sent. */
export function buildAskPayload(input: AskPayloadInput): string {
  return JSON.stringify({
    outcome: input.outcome,
    indicators: input.indicators,
    misconceptions: input.misconceptions,
    slide: input.slide,
    learner: input.learner,
    history: input.history.slice(-3),
    exit_ticket_equations: input.exitTicketEquations,
    question: input.question,
  });
}

export const AskModelOutputSchema = z.object({
  answer: z.string().min(1),
  check_question: z.string().default(""),
  indicator: z.string().nullable().default(null),
  misconception: z.string().nullable().default(null),
  math_claims: z.array(z.object({ equation: z.string(), x: z.number() })).default([]),
  safety_concern: z.boolean().default(false),
});

export type AskModelOutput = z.infer<typeof AskModelOutputSchema>;

/** Parses model JSON defensively: strips code fences, finds the first {...}, never throws. */
export function parseModelJson(text: string): AskModelOutput | null {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = AskModelOutputSchema.safeParse(JSON.parse(stripped.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
