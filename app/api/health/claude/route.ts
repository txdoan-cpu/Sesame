import { connection } from "next/server";
import { healthCheck } from "@/lib/llm";
import { HealthResultSchema } from "@/lib/llm/types";

// GET /api/health/claude — Round 0 smoke test. Returns {ok, model, reply} or {ok: false, error}.
export async function GET() {
  await connection(); // run at request time, never at build time
  const result = HealthResultSchema.parse(await healthCheck());
  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
