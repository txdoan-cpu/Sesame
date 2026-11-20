/**
 * Deterministic Content Author and Critic for tests (LLM_PROVIDER=mock).
 * Writes a correct linear-equations lesson for any plan. If an approved
 * material contains "MATHBUG", one practice answer is wrong on purpose, so the
 * math gate blocks delivery and the lesson reaches the teacher review queue.
 */

type Spec = {
  spec: string;
  template: string;
  items: number;
  indicators: string[];
  misconception: string | null;
  transfer: boolean;
  example: number | null;
};
type Payload = {
  outcome?: { code?: string; indicators?: { code: string }[]; misconceptions?: { code: string }[] };
  skills?: string[];
  materials?: { ref: string; text: string }[];
  slides?: Spec[];
};

const numeric = (prompt: string, equation: string, answer: number, skill: string) => ({
  kind: "numeric",
  prompt,
  equation,
  answer,
  hints: ["Undo the adding or taking away first.", "Do the same thing to both sides.", `The answer is close to ${answer}.`],
  correct_feedback: `Yes! x = ${answer}.`,
  skill,
});

const WORKED = [
  { lines: ["3x + 4 = 19", "3x = 15", "x = 5"], solution: 5, check: "3(5) + 4 = 19" },
  { lines: ["2x - 5 = 9", "2x = 14", "x = 7"], solution: 7, check: "2(7) - 5 = 9" },
  { lines: ["4x + 1 = 21", "4x = 20", "x = 5"], solution: 5, check: "4(5) + 1 = 21" },
];
const PRACTICE: [string, number][] = [
  ["2x + 9 = 1", -4],
  ["x/3 + 4 = 6", 6],
  ["4(x - 2) = 12", 5],
  ["3x - 4 = 11", 5],
  ["x/2 - 3 = 1", 8],
  ["3(x + 1) = 15", 4],
  ["6x + 2 = 20", 3],
  ["5x - 3 = 12", 3],
];

export function mockAuthor(user: string): string {
  let p: Payload = {};
  try {
    p = JSON.parse(user) as Payload;
  } catch {
    // defaults below
  }
  const skills = p.skills?.length ? p.skills : ["LO.core"];
  const sk = (i: number) => skills[i % skills.length];
  const mis = p.outcome?.misconceptions?.map((m) => m.code) ?? ["M1"];
  const bug = (p.materials ?? []).some((m) => m.text.includes("MATHBUG"));
  const ref = p.materials?.[0]?.ref ?? "m1";
  const code = p.outcome?.code ?? "LO";

  const slides = (p.slides ?? []).map((s, i) => {
    const base = { spec: s.spec, sources: [ref] };
    switch (s.template) {
      case "retrieval":
        return { ...base, title: "Warm-up", body_md: "Two quick ones from before.", narration: "Let's wake up our brains with two quick questions you already know how to do.", visual: { type: "none" }, items: [numeric("Solve $x + 4 = 9$", "x + 4 = 9", 5, sk(0)), numeric("Solve $3x = 12$", "3x = 12", 4, sk(0))].slice(0, s.items) };
      case "cpa":
        return { ...base, title: "Keep it balanced", body_md: "Both pans hold the same amount.", narration: "Picture a balance scale at the rink. On one side, x and three pucks. On the other, seven pucks. What is x?", visual: { type: "balance", left: "x + 3", right: "7" }, items: [numeric("Solve $x + 3 = 7$", "x + 3 = 7", 4, sk(0))] };
      case "worked_example": {
        const w = WORKED[((s.example ?? 1) - 1) % WORKED.length];
        return { ...base, title: `Worked example ${s.example ?? 1}`, body_md: `Solve $${w.lines[0]}$ step by step.`, narration: "Watch each step. We undo the adding first, then the multiplying, and we always do it to both sides.", visual: { type: "steps", lines: w.lines, solution: w.solution, check: w.check } };
      }
      case "faded_example":
        return { ...base, title: "Your turn to finish it", body_md: "One step is missing. Fill it in.", narration: "This time I start and you finish. Look at the missing step and work out x.", visual: { type: "steps", lines: ["5x - 7 = 18", "5x = 25", "x = 5"], solution: 5, hidden_line: 1 }, items: [numeric("What is $x$ in $5x - 7 = 18$?", "5x - 7 = 18", 5, sk(0))] };
      case "whos_right":
        return {
          ...base,
          title: "Who's right?",
          body_md: "Two students solved $2(x + 3) = 14$.",
          narration: "Maya and Liam both solved the same equation. Only one of them is right. Look closely at the first step.",
          visual: {
            type: "compare",
            equation: "2(x + 3) = 14",
            people: [
              { name: "Maya", lines: ["2x + 6 = 14", "2x = 8", "x = 4"], answer: 4 },
              { name: "Liam", lines: ["2x + 3 = 14", "2x = 11", "x = 5.5"], answer: 5.5 },
            ],
          },
          items: [
            {
              kind: "choice",
              prompt: "Who is right?",
              skill: sk(1),
              options: [
                { text: "Maya. The 2 multiplies both x and 3.", correct: true, feedback: "Yes! Share the 2 with both terms." },
                { text: "Liam. You only multiply the x.", correct: false, feedback: "Not quite. The 2 multiplies everything in the brackets.", misconception: s.misconception ?? mis[0] },
              ],
            },
          ],
        };
      case "discovery":
        return { ...base, title: "What do you notice?", body_md: "Try it and look for the rule.", narration: "Try this one and notice what you did to each side.", visual: { type: "none" }, items: [numeric("Solve $x + 6 = 10$", "x + 6 = 10", 4, sk(0))] };
      case "practice": {
        const items = PRACTICE.slice(0, Math.max(0, s.items - (s.transfer ? 1 : 0))).map(([eq, ans], k) => numeric(`Solve $${eq}$`, eq, bug && k === 0 ? ans + 1 : ans, sk(k)));
        if (s.transfer) items.push(numeric("A team pays 30 dollars for the rink plus 5 dollars per player. The bill is 90 dollars. How many players?", "5x + 30 = 90", 12, sk(0)));
        return { ...base, title: "Practice", body_md: "Use a hint if you need one.", narration: "Now you try some on your own. There is no rush.", visual: { type: "none" }, items };
      }
      case "transfer":
        return { ...base, title: "Real-life challenge", body_md: "A problem from the rink.", narration: "Here is a real problem. Turn the story into an equation first.", visual: { type: "none" }, items: [numeric("A team pays 30 dollars for the rink plus 5 dollars per player. The bill is 90 dollars. How many players?", "5x + 30 = 90", 12, sk(0))] };
      case "self_explain":
      case "close":
        return {
          ...base,
          title: s.template === "close" ? "The big idea" : "Why does it work?",
          body_md: "Keep the equation balanced.",
          narration: "Before we finish, think about why every step works. Then tell me in your own words.",
          visual: { type: "none" },
          items: [
            {
              kind: "choice",
              prompt: "Why do we do the same thing to both sides?",
              skill: sk(0),
              options: [
                { text: "To keep the equation balanced.", correct: true, feedback: "Yes! Both sides stay equal." },
                { text: "Because the right side is the answer.", correct: false, feedback: "Not quite. The = sign means balanced.", misconception: mis[0] },
                { text: "To make the numbers smaller.", correct: false, feedback: "Not quite. Think about balance.", misconception: mis[0] },
              ],
            },
          ],
        };
      default:
        return { ...base, title: `Slide ${i + 1}`, body_md: "Let's keep going.", narration: "Here is the next idea.", visual: { type: "none" }, items: [] };
    }
  });

  const ind = p.outcome?.indicators?.map((x) => x.code) ?? [];
  const at = (k: number) => ind[k % Math.max(ind.length, 1)];
  const m = (k: number) => mis[k % mis.length];
  return JSON.stringify({
    title: `${code}: solving equations step by step`,
    slides,
    diagnostic: [numeric("Solve $x + 5 = 9$", "x + 5 = 9", 4, sk(0)), numeric("Solve $3x = 12$", "3x = 12", 4, sk(0)), numeric("Solve $2x + 1 = 7$", "2x + 1 = 7", 3, sk(0))],
    exit_ticket: {
      choice: [
        { prompt: "Solve $4x + 3 = 23$", equation: "4x + 3 = 23", indicator: at(0), skill: sk(0), options: [{ text: "x = 5", value: 5, correct: true }, { text: "x = 6.5", value: 6.5, correct: false, misconception: m(0) }, { text: "x = 2.75", value: 2.75, correct: false, misconception: m(1) }] },
        { prompt: "Solve $2(x + 5) = 16$", equation: "2(x + 5) = 16", indicator: at(1), skill: sk(1), options: [{ text: "x = 5.5", value: 5.5, correct: false, misconception: m(1) }, { text: "x = 3", value: 3, correct: true }, { text: "x = 13", value: 13, correct: false, misconception: m(0) }] },
        { prompt: "Solve $x/2 + 1 = 4$", equation: "x/2 + 1 = 4", indicator: at(2), skill: sk(0), options: [{ text: "x = 1.5", value: 1.5, correct: false, misconception: m(0) }, { text: "x = 10", value: 10, correct: false, misconception: m(1) }, { text: "x = 6", value: 6, correct: true }] },
      ],
      explain: { prompt: "In your own words: what is the most important rule when you solve an equation?", keywords: ["balanc", "both sides", "same (thing|on each)"] },
    },
  });
}

export function mockCritic(): string {
  return JSON.stringify({
    scores: { S2: 3, S6: 3, S7: 3, S8: 3, S9: 3, S11: 3 },
    s12: { content: 5, design: 5, coherence: 5 },
    reasons: {},
    summary: "Mock review for tests: clear steps, cited sources, suitable for the learner.",
  });
}
