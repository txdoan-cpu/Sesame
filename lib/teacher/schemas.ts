import Papa from "papaparse";
import { z } from "zod";

/**
 * Teacher input (CLAUDE.md §7.7): curriculum packs, outcomes (form or CSV/JSON
 * import) and materials. Pure functions: used by the browser preview and
 * re-checked on the server.
 */

export const BLOOM_LEVELS = ["remember", "understand", "apply", "analyse", "evaluate", "create"] as const;
export const KNOWLEDGE_TYPES = ["conceptual", "procedural"] as const;
export const LICENCES = ["cc_by", "cc_by_sa", "cc_by_nc", "cc_by_nc_sa", "cc0", "public_domain", "public_document", "fair_dealing", "other"] as const;
/** These need a written note (why use is allowed). */
export const LICENCES_NEEDING_NOTE: readonly string[] = ["fair_dealing", "other"];

const code = (max = 20) => z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "code").max(max);

export const CurriculumInputSchema = z.object({
  province: z.string().trim().min(2).max(40),
  grade: z.coerce.number().int().min(1).max(12),
  subject: z.string().trim().min(2).max(80),
  sourceTitle: z.string().trim().min(3).max(200),
  sourceUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).optional(),
});

const CodedText = z.object({ code: code(30), description: z.string().trim().min(3).max(500) });

export const OutcomeInputSchema = z.object({
  code: code(20),
  strand: code(10),
  description: z.string().trim().min(5).max(1000),
  bloomLevel: z.enum(BLOOM_LEVELS),
  knowledgeType: z.enum(KNOWLEDGE_TYPES),
  indicators: z.array(CodedText).max(20).default([]),
  misconceptions: z.array(CodedText).max(20).default([]),
  prerequisites: z.array(code(20)).max(20).default([]),
});

export type OutcomeInput = z.infer<typeof OutcomeInputSchema>;

export const MaterialInputSchema = z
  .object({
    packId: z.uuid(),
    title: z.string().trim().min(3).max(200),
    outcomeCodes: z.array(code(20)).min(1).max(20),
    licence: z.enum(LICENCES),
    licenceNote: z.string().trim().max(500).optional(),
    sourceUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).optional(),
  })
  .refine((m) => !LICENCES_NEEDING_NOTE.includes(m.licence) || (m.licenceNote ?? "").length >= 10, {
    message: "licence_note",
    path: ["licenceNote"],
  });

/** "PR3.1: Solve ...; PR3.2: Check ..." → [{code, description}] */
export function parseCodedList(raw: unknown): { code: string; description: string }[] {
  if (Array.isArray(raw)) return raw as { code: string; description: string }[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(/;|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf(":");
      return i < 0 ? { code: part, description: "" } : { code: part.slice(0, i).trim(), description: part.slice(i + 1).trim() };
    });
}

function parseCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  return raw
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One raw record from CSV or JSON → the shape OutcomeInputSchema expects. */
function normalise(rec: Record<string, unknown>) {
  const get = (...keys: string[]) => keys.map((k) => rec[k]).find((v) => v !== undefined && v !== "");
  const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace("analyze", "analyse") : v);
  return {
    code: get("code"),
    strand: get("strand"),
    description: get("description", "description_en"),
    bloomLevel: lower(get("bloom_level", "bloomLevel", "bloom")),
    knowledgeType: lower(get("knowledge_type", "knowledgeType")),
    indicators: parseCodedList(get("indicators")),
    misconceptions: parseCodedList(get("misconceptions")),
    prerequisites: parseCodes(get("prerequisites")),
  };
}

export type ImportRow = {
  line: number;
  input: OutcomeInput | null;
  raw: Record<string, unknown>;
  issues: string[];
};

/** Parses a CSV or JSON file into rows with their validation issues. Never throws. */
export function parseOutcomeImport(text: string, filename: string): { rows: ImportRow[]; fileError: string | null } {
  let records: Record<string, unknown>[] = [];
  const isJson = /\.json$/i.test(filename) || /^\s*[[{]/.test(text);
  try {
    if (isJson) {
      const data: unknown = JSON.parse(text);
      const list = Array.isArray(data) ? data : (data as { outcomes?: unknown }).outcomes;
      if (!Array.isArray(list)) return { rows: [], fileError: "The JSON must be an array of outcomes (or { \"outcomes\": [...] })." };
      records = list as Record<string, unknown>[];
    } else {
      const parsed = Papa.parse<Record<string, string>>(text.trim(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      });
      if (parsed.errors.length && !parsed.data.length) return { rows: [], fileError: `CSV error: ${parsed.errors[0].message}` };
      records = parsed.data;
    }
  } catch {
    return { rows: [], fileError: "The file could not be read as CSV or JSON." };
  }
  if (!records.length) return { rows: [], fileError: "The file has no outcomes." };
  if (records.length > 100) return { rows: [], fileError: "Import at most 100 outcomes at a time." };

  const rows = records.map((rec, i): ImportRow => {
    const parsed = OutcomeInputSchema.safeParse(normalise(rec));
    return {
      line: i + (isJson ? 1 : 2), // CSV line 1 is the header
      raw: rec,
      input: parsed.success ? parsed.data : null,
      issues: parsed.success ? [] : parsed.error.issues.map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`),
    };
  });
  return { rows, fileError: null };
}

/**
 * Flags duplicate outcome codes: repeated inside the file, or already in the
 * database (any pack: outcome codes are unique). Also flags duplicate
 * indicator / misconception codes within one outcome.
 */
export function flagDuplicates(rows: ImportRow[], existingCodes: ReadonlySet<string>): ImportRow[] {
  const seen = new Map<string, number>();
  for (const r of rows) if (r.input) seen.set(r.input.code.toLowerCase(), (seen.get(r.input.code.toLowerCase()) ?? 0) + 1);
  return rows.map((r) => {
    if (!r.input) return r;
    const issues = [...r.issues];
    const key = r.input.code.toLowerCase();
    if ((seen.get(key) ?? 0) > 1) issues.push(`code ${r.input.code} appears more than once in this file`);
    if ([...existingCodes].some((c) => c.toLowerCase() === key)) issues.push(`code ${r.input.code} already exists`);
    for (const list of ["indicators", "misconceptions"] as const) {
      const codes = r.input[list].map((x) => x.code.toLowerCase());
      if (new Set(codes).size !== codes.length) issues.push(`${list}: repeated code`);
    }
    return { ...r, issues };
  });
}
