import { describe, expect, it } from "vitest";
import { SAFETY_MESSAGE, screenQuestion } from "@/lib/llm/safety";

describe("screenQuestion flags concerning questions", () => {
  it.each([
    ["I want to kill myself", "self_harm"],
    ["sometimes i wanna die", "self_harm"],
    ["I don't want to be alive anymore", "self_harm"],
    ["I’ve been cutting myself", "self_harm"],
    ["is suicide bad", "self_harm"],
    ["my dad hits me when I get it wrong", "abuse"],
    ["I'm scared to go home", "abuse"],
    ["someone touched me", "abuse"],
    ["kids at school bully me every day", "bullying"],
    ["they make fun of me in math class", "bullying"],
    ["everyone hates me", "bullying"],
    ["a kid said he will bring a gun to school", "danger"],
    ["someone is following me home", "danger"],
    ["I am not safe at home", "danger"],
    ["I don't feel safe", "danger"],
    ["I want to run away from home", "danger"],
  ])("%j -> %s", (q, category) => {
    expect(screenQuestion(q)).toEqual({ flagged: true, category });
  });
});

describe("screenQuestion lets normal questions through", () => {
  it.each([
    "why do we take away 4 from both sides?",
    "I don't get it",
    "this is killing me, it's so hard", // frustration, not self-harm
    "what does the equals sign mean",
    "can I divide first?",
    "how many hours did I skate",
    "I am safe, I just don't get step 2",
    "is x = 5 right?",
    "what is a negative times a negative",
  ])("%j", (q) => {
    expect(screenQuestion(q)).toEqual({ flagged: false, category: null });
  });
});

describe("SAFETY_MESSAGE", () => {
  it("is calm, points to a trusted adult and Kids Help Phone", () => {
    expect(SAFETY_MESSAGE).toMatch(/trusted adult/);
    expect(SAFETY_MESSAGE).toMatch(/1-800-668-6868/);
    expect(SAFETY_MESSAGE).toMatch(/686868/);
  });
});

describe("safetyRoute (owner decision, Round 4)", () => {
  it("possible abuse is reviewed, not sent to the parent", async () => {
    const { safetyRoute, safetyMessage } = await import("@/lib/llm/safety");
    expect(safetyRoute("abuse")).toBe("review_only");
    expect(safetyMessage("abuse")).not.toMatch(/parent/i);
    expect(safetyMessage("abuse")).toMatch(/1-800-668-6868/);
  });

  it.each(["self_harm", "bullying", "danger", "other_concern"] as const)("%s notifies the parent", async (c) => {
    const { safetyRoute } = await import("@/lib/llm/safety");
    expect(safetyRoute(c)).toBe("notify_parent");
  });
});
