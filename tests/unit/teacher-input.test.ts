import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { htmlToText, isPublicHttpUrl } from "@/lib/materials/extract";
import { RUBRIC_R, parseRubricAnswer, rubricPayload, scoreRubric } from "@/lib/materials/rubric";
import { mockGenerate } from "@/lib/llm/mock";
import { MaterialInputSchema, flagDuplicates, parseCodedList, parseOutcomeImport } from "@/lib/teacher/schemas";

const all = (n: number) => Object.fromEntries(RUBRIC_R.criteria.map((c) => [c.id, n]));

describe("Rubric R data (Appendix C)", () => {
  it("has R1–R10 with weights summing to 100 and gates R1, R3, R5, R9", () => {
    expect(RUBRIC_R.criteria.map((c) => c.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]);
    expect(RUBRIC_R.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(RUBRIC_R.criteria.filter((c) => c.gate).map((c) => c.id)).toEqual(["R1", "R3", "R5", "R9"]);
    expect(RUBRIC_R.gate_min).toBe(2);
    expect(RUBRIC_R.select_min_weighted_mean).toBe(2);
  });
});

describe("scoreRubric", () => {
  it("approves when every gate is >= 2 and the weighted mean is >= 2.0", () => {
    const r = scoreRubric({ scores: all(2), reasons: {}, summary: "" });
    expect(r.weightedMean).toBe(2);
    expect(r.percent).toBe(67);
    expect(r.decision).toBe("approved");
    expect(r.failedGates).toEqual([]);
  });

  it.each(["R1", "R3", "R5", "R9"])("rejects when gate %s scores below 2, even with a high mean", (gate) => {
    const r = scoreRubric({ scores: { ...all(3), [gate]: 1 }, reasons: { [gate]: "because" }, summary: "" });
    expect(r.weightedMean).toBeGreaterThan(2);
    expect(r.decision).toBe("rejected");
    expect(r.failedGates).toEqual([gate]);
    expect(r.rejectReasons[0]).toContain(gate);
    expect(r.rejectReasons[0]).toContain("because");
  });

  it("does not gate non-gate criteria", () => {
    const r = scoreRubric({ scores: { ...all(3), R6: 0, R8: 0 }, reasons: {}, summary: "" });
    expect(r.failedGates).toEqual([]);
    expect(r.decision).toBe("approved");
  });

  it("rejects when the weighted mean is below 2.0 with all gates passing", () => {
    // Gates at 2 (50% of weight), the rest at 1 → mean 1.5.
    const r = scoreRubric({ scores: { ...all(1), R1: 2, R3: 2, R5: 2, R9: 2 }, reasons: {}, summary: "" });
    expect(r.weightedMean).toBe(1.5);
    expect(r.failedGates).toEqual([]);
    expect(r.decision).toBe("rejected");
    expect(r.rejectReasons.join(" ")).toMatch(/below 2\.0/);
  });

  it("counts a missing criterion as 0", () => {
    const { R1: _drop, ...rest } = all(3);
    void _drop;
    const r = scoreRubric({ scores: rest, reasons: {}, summary: "" });
    expect(r.scores.R1).toBe(0);
    expect(r.failedGates).toContain("R1");
  });
});

describe("parseRubricAnswer", () => {
  it("reads JSON inside code fences and chatter", () => {
    const a = parseRubricAnswer('Here you go:\n```json\n{"scores": {"R1": 3, "R2": "2"}, "summary": "ok"}\n```');
    expect(a?.scores).toEqual({ R1: 3, R2: 2 });
    expect(a?.reasons).toEqual({});
  });
  it.each(["no json here", '{"scores": {"R1": 7}}', "{broken"])("returns null for %s", (t) => {
    expect(parseRubricAnswer(t)).toBeNull();
  });
});

describe("mock reviewer (used by e2e tests)", () => {
  const ask = async (text: string, extra: Partial<{ licence: string; licenceNote: string | null; sourceUrl: string | null }> = {}) => {
    const r = await mockGenerate({
      system: "",
      maxTokens: 900,
      json: true,
      user: rubricPayload({
        material: { title: "T", sourceUrl: "https://www.gov.nl.ca/x", licence: "cc_by", licenceNote: null, text, ...extra },
        outcomes: [],
      }),
    });
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("approves a good material and rejects one with a wrong answer (R3)", async () => {
    const good = scoreRubric(parseRubricAnswer((await ask("Solve 2x + 3 = 11. x = 4.")).text)!);
    expect(good.decision).toBe("approved");
    const bad = scoreRubric(parseRubricAnswer((await ask("2x + 3 = 11 so x = 5 WRONG")).text)!);
    expect(bad.decision).toBe("rejected");
    expect(bad.failedGates).toEqual(["R3"]);
  });
});

describe("Outcome import (CSV / JSON)", () => {
  const csv = [
    "code,strand,description,bloom_level,knowledge_type,indicators,misconceptions,prerequisites",
    'T9PR1,PR,Solve two-step equations with fractions,apply,procedural,"T9PR1.1: Isolate the variable; T9PR1.2: Check by substitution",M1: Operates on one side only,8PR2',
    "T9PR2,PR,Explain why equations stay balanced,understand,conceptual,,,",
  ].join("\n");

  it("parses CSV rows with coded lists", () => {
    const { rows, fileError } = parseOutcomeImport(csv, "outcomes.csv");
    expect(fileError).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0].line).toBe(2);
    expect(rows[0].issues).toEqual([]);
    expect(rows[0].input?.indicators).toEqual([
      { code: "T9PR1.1", description: "Isolate the variable" },
      { code: "T9PR1.2", description: "Check by substitution" },
    ]);
    expect(rows[0].input?.misconceptions[0].code).toBe("M1");
    expect(rows[0].input?.prerequisites).toEqual(["8PR2"]);
    expect(rows[1].input?.knowledgeType).toBe("conceptual");
  });

  it("parses JSON arrays and { outcomes: [...] }", () => {
    const one = { code: "J1", strand: "PR", description: "Model linear relations", bloom_level: "apply", knowledge_type: "procedural" };
    expect(parseOutcomeImport(JSON.stringify([one]), "a.json").rows[0].issues).toEqual([]);
    expect(parseOutcomeImport(JSON.stringify({ outcomes: [one] }), "a.json").rows[0].input?.code).toBe("J1");
    expect(parseOutcomeImport('{"x": 1}', "a.json").fileError).toMatch(/array/);
  });

  it("reports invalid rows instead of throwing", () => {
    const { rows } = parseOutcomeImport("code,strand,description,bloom_level,knowledge_type\nbad code!,PR,x,apply,maybe", "x.csv");
    expect(rows[0].input).toBeNull();
    expect(rows[0].issues.length).toBeGreaterThan(0);
  });

  it("refuses empty files and files over 100 rows", () => {
    expect(parseOutcomeImport("code,strand\n", "x.csv").fileError).toBeTruthy();
    const many = Array.from({ length: 101 }, (_, i) => ({ code: `C${i}`, strand: "PR", description: "Some outcome", bloom_level: "apply", knowledge_type: "procedural" }));
    expect(parseOutcomeImport(JSON.stringify(many), "m.json").fileError).toMatch(/100/);
  });

  it("flags codes repeated in the file and codes that already exist (case-insensitive)", () => {
    const { rows } = parseOutcomeImport(csv + "\nt9pr1,PR,Duplicate in file,apply,procedural,,,", "o.csv");
    const flagged = flagDuplicates(rows, new Set(["8PR2", "T9PR2"]));
    expect(flagged[0].issues.join()).toMatch(/more than once/);
    expect(flagged[2].issues.join()).toMatch(/more than once/);
    expect(flagged[1].issues.join()).toMatch(/already exists/);
  });

  it("flags repeated indicator codes inside one outcome", () => {
    const { rows } = parseOutcomeImport(
      JSON.stringify([{ code: "Z1", strand: "PR", description: "Something real", bloom_level: "apply", knowledge_type: "procedural", indicators: "A: one; A: two" }]),
      "z.json",
    );
    expect(flagDuplicates(rows, new Set())[0].issues.join()).toMatch(/indicators: repeated code/);
  });

  it("parseCodedList splits on ; and newlines and skips blanks", () => {
    expect(parseCodedList("A1: one\n\nB2: two; C3: three")).toEqual([
      { code: "A1", description: "one" },
      { code: "B2", description: "two" },
      { code: "C3", description: "three" },
    ]);
    expect(parseCodedList("")).toEqual([]);
  });
});

describe("Material input: licence is required", () => {
  const base = { packId: "00000000-0000-4000-8000-000000000008", title: "Balance scale notes", outcomeCodes: ["8PR2"], sourceUrl: "" };
  it("accepts a CC licence without a note", () => {
    expect(MaterialInputSchema.safeParse({ ...base, licence: "cc_by" }).success).toBe(true);
  });
  it("rejects a missing or unknown licence", () => {
    expect(MaterialInputSchema.safeParse(base).success).toBe(false);
    expect(MaterialInputSchema.safeParse({ ...base, licence: "mine" }).success).toBe(false);
  });
  it.each(["fair_dealing", "other"])("needs a note of 10+ characters for %s", (licence) => {
    expect(MaterialInputSchema.safeParse({ ...base, licence }).success).toBe(false);
    expect(MaterialInputSchema.safeParse({ ...base, licence, licenceNote: "short" }).success).toBe(false);
    expect(MaterialInputSchema.safeParse({ ...base, licence, licenceNote: "Short excerpt for private study" }).success).toBe(true);
  });
  it("needs at least one outcome", () => {
    expect(MaterialInputSchema.safeParse({ ...base, licence: "cc0", outcomeCodes: [] }).success).toBe(false);
  });
});

describe("URL safety and HTML text", () => {
  it.each(["https://www.gov.nl.ca/education/", "http://example.org/a.pdf"])("allows public %s", (u) => {
    expect(isPublicHttpUrl(u)).toBe(true);
  });
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "ftp://example.org/x",
    "file:///etc/passwd",
    "not a url",
  ])("blocks %s", (u) => {
    expect(isPublicHttpUrl(u)).toBe(false);
  });
  it("htmlToText drops scripts and tags and keeps paragraphs", () => {
    const t = htmlToText("<html><script>alert(1)</script><style>p{}</style><p>Solve 2x&nbsp;+ 3 = 11</p><p>x = 4 &amp; done</p></html>");
    expect(t).not.toContain("alert");
    expect(t).toContain("Solve 2x + 3 = 11");
    expect(t).toContain("x = 4 & done");
    expect(t.split("\n").length).toBeGreaterThan(1);
  });
});
