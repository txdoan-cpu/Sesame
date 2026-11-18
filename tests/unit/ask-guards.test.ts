import { describe, expect, it } from "vitest";
import { equationsInText, leaksExitAnswer, statedValues, trimWords, verifyMath } from "@/lib/llm/guard";
import { ASK_SYSTEM_PROMPT, buildAskPayload, parseModelJson, type AskModelOutput } from "@/lib/llm/prompts";

const out = (o: Partial<AskModelOutput>): AskModelOutput => ({
  answer: "",
  check_question: "",
  indicator: null,
  misconception: null,
  math_claims: [],
  safety_concern: false,
  ...o,
});

describe("system prompt carries the §7.2 rules", () => {
  it.each([
    /80 words/,
    /Grade 6/,
    /Canadian English/,
    /balance scale|algebra tiles/,
    /Never give the final answer/,
    /off-topic/,
    /check question/,
    /safety_concern/,
  ])("%s", (re) => {
    expect(ASK_SYSTEM_PROMPT).toMatch(re);
  });
});

describe("buildAskPayload", () => {
  it("sends only the last 3 turns and the slide context", () => {
    const payload = JSON.parse(
      buildAskPayload({
        outcome: { code: "8PR2", description: "Solve linear equations" },
        indicators: [],
        misconceptions: [],
        slide: { no: 3, title: "Skate rental", body: "b", narration: "n", indicators: ["PR2.3"] },
        learner: { reading_level: "grade 6", interests: ["hockey"], misconceptions: ["M2"] },
        history: [1, 2, 3, 4].map((i) => ({ question: `q${i}`, answer: `a${i}` })),
        question: "why?",
        exitTicketEquations: ["4x + 3 = 23"],
      }),
    );
    expect(payload.history.map((h: { question: string }) => h.question)).toEqual(["q2", "q3", "q4"]);
    expect(payload.slide.title).toBe("Skate rental");
    expect(payload.learner.interests).toEqual(["hockey"]);
    expect(payload.exit_ticket_equations).toEqual(["4x + 3 = 23"]);
  });
});

describe("parseModelJson", () => {
  it("accepts plain JSON, fenced JSON and JSON with chatter", () => {
    const body = '{"answer":"Hi","check_question":"Ok?","indicator":"PR2.3","misconception":null,"math_claims":[],"safety_concern":false}';
    expect(parseModelJson(body)?.answer).toBe("Hi");
    expect(parseModelJson("```json\n" + body + "\n```")?.indicator).toBe("PR2.3");
    expect(parseModelJson("Sure! " + body + " Hope that helps.")?.check_question).toBe("Ok?");
  });

  it("fills defaults and returns null on junk", () => {
    expect(parseModelJson('{"answer":"Only this"}')).toMatchObject({ answer: "Only this", math_claims: [], safety_concern: false });
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson('{"answer": ')).toBeNull();
    expect(parseModelJson('{"answer": ""}')).toBeNull();
  });
});

describe("math guard", () => {
  it("finds stated values and equations", () => {
    expect(statedValues("So x = 5. Or is x is −4? x equals 6.")).toEqual([5, -4, 6]);
    expect(statedValues("3x = 15")).toEqual([]);
    expect(statedValues("Here x is 4 times bigger. x = 2 + 3 is not done yet.")).toEqual([]);
    expect(statedValues("x is 5.")).toEqual([5]);
    expect(equationsInText("First 3x + 4 = 19, then 3x = 15.")).toEqual(["3x + 4 = 19", "3x = 15"]);
  });

  it("passes correct claims and values that solve a slide equation", () => {
    const o = out({ answer: "Take away 4 from both sides. 3x = 15, so x = 5.", math_claims: [{ equation: "3x + 4 = 19", x: 5 }] });
    expect(verifyMath(o, ["3x + 4 = 19"])).toEqual({ ok: true, failures: [] });
  });

  it("fails a wrong claim", () => {
    const o = out({ answer: "So x = 7.", math_claims: [{ equation: "3x + 4 = 19", x: 7 }] });
    expect(verifyMath(o, ["3x + 4 = 19"]).ok).toBe(false);
  });

  it("fails a stated value that solves nothing known, even without a claim", () => {
    expect(verifyMath(out({ answer: "Then x = 6." }), ["3x + 4 = 19"]).ok).toBe(false);
    expect(verifyMath(out({ answer: "Then x = 6." }), []).ok).toBe(false);
  });

  it("passes answers with no numeric result", () => {
    expect(verifyMath(out({ answer: "Do the same to both sides." }), []).ok).toBe(true);
  });
});

describe("exit-ticket leak guard", () => {
  const exits = [{ equation: "4x + 3 = 23", answer: 5 }, { equation: "2(x + 5) = 16", answer: 3 }];

  it("catches a stated answer for an exit equation", () => {
    expect(leaksExitAnswer(out({ answer: "For 4x + 3 = 23, x = 5." }), exits)).toBe(true);
    expect(leaksExitAnswer(out({ answer: "Ok", math_claims: [{ equation: "2(x+5)=16", x: 3 }] }), exits)).toBe(true);
  });

  it("allows hints and other equations", () => {
    expect(leaksExitAnswer(out({ answer: "For 4x + 3 = 23, take away 3 from both sides first." }), exits)).toBe(false);
    expect(leaksExitAnswer(out({ answer: "In 3x + 4 = 19, x = 5." }), exits)).toBe(false);
  });
});

describe("trimWords", () => {
  it("cuts long answers at a sentence end", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence ${i} has five words.`).join(" ");
    const cut = trimWords(long, 100);
    expect(cut.split(/\s+/).length).toBeLessThanOrEqual(100);
    expect(cut.endsWith(".")).toBe(true);
    expect(trimWords("Short one.", 100)).toBe("Short one.");
  });
});
