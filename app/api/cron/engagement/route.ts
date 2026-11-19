import { connection } from "next/server";
import { z } from "zod";
import { runSweeps } from "@/lib/sweeps";

// GET|POST /api/cron/engagement: scheduled checks (stale sessions, missed sessions,
// reward deadlines, weekly reports). Called by a scheduler with
// "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends this header).

const TestOptions = z.object({
  now: z.iso.datetime().optional(),
  forceWeekly: z.boolean().optional(),
  learnerIds: z.array(z.uuid()).max(50).optional(),
});

async function handle(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, code: "not_configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  // Tests may move the clock and limit the sweep to their own families.
  let options: z.infer<typeof TestOptions> = {};
  if (process.env.ALLOW_TEST_CLOCK === "1" && request.method === "POST") {
    const parsed = TestOptions.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ ok: false, code: "invalid_input" }, { status: 400 });
    options = parsed.data;
  }

  const now = options.now ? new Date(options.now) : new Date();
  const result = await runSweeps(now, { forceWeekly: options.forceWeekly, scope: options.learnerIds });
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
