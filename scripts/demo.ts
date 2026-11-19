/**
 * Demo accounts and scenario helpers (synthetic data only).
 *
 *   npm run demo:reset        Fresh demo family: parent.demo@example.com + learner demo_a (Alex),
 *                             profile demo-A, weekly schedule, the scenario-B reward goal.
 *   npm run demo:time-travel  Scenario B: pretend a week has passed since Alex reached 8PR2,
 *                             and 8PR1 was reached and re-checked in class earlier.
 *   npm run demo:slot-now     Scenario C: add a study slot that is happening right now.
 *
 * Password: DEMO_PASSWORD from .env.local, or a random one printed once.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { LearnerProfileSchema, outcomeMastery, statusForMastery, toLearnerProfileRow } from "../lib/learner-profile.ts";
import { SHARING_ITEMS } from "../lib/sharing.ts";
import { localNow } from "../lib/time.ts";

nextEnv.loadEnvConfig(process.cwd());

const PARENT = { email: "parent.demo@example.com", displayName: "Demo Parent" };
const LEARNER = { username: "demo_a", displayName: "Alex" };
const LEARNER_EMAIL = `${LEARNER.username}@learners.sesame.invalid`;
const DAY = 86_400_000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
}

async function upsertUser(email: string, displayName: string, password: string, appMetadata?: Record<string, string>): Promise<string> {
  const existing = await findUserIdByEmail(email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, { password });
    if (error) throw error;
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return data.user.id;
}

async function demoIds(): Promise<{ parentId: string; learnerId: string }> {
  const parentId = await findUserIdByEmail(PARENT.email);
  const learnerId = await findUserIdByEmail(LEARNER_EMAIL);
  if (!parentId || !learnerId) throw new Error("Demo accounts not found. Run: npm run demo:reset");
  return { parentId, learnerId };
}

/** The deadline from the proposal (15 Dec 2026), or 30 days ahead once that has passed. */
function scenarioBDeadline(): string {
  const proposal = "2026-12-15";
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
  return new Date(`${proposal}T23:59:00Z`).getTime() - Date.now() > 14 * DAY ? proposal : soon;
}

async function reset() {
  const passwordFromEnv = process.env.DEMO_PASSWORD?.trim();
  const password = passwordFromEnv || `demo-${randomBytes(6).toString("base64url")}`;
  if (password.length < 8) throw new Error("DEMO_PASSWORD must be at least 8 characters.");

  const profile = LearnerProfileSchema.parse(JSON.parse(readFileSync(new URL("../content/profiles/demo-A.json", import.meta.url), "utf8")));
  const parentId = await upsertUser(PARENT.email, PARENT.displayName, password);
  const learnerId = await upsertUser(LEARNER_EMAIL, LEARNER.displayName, password, { role: "learner", username: LEARNER.username });

  // Clear everything the demo creates, so it can run again from the start.
  for (const table of ["sessions", "assessments", "questions", "safety_reviews", "reward_rules", "schedule_change_requests", "schedules", "outcome_status"]) {
    must(await admin.from(table).delete().eq("learner_id", learnerId), `clear ${table}`);
  }
  must(await admin.from("notifications").delete().in("recipient_id", [parentId, learnerId]), "clear notifications");
  for (const s of SHARING_ITEMS.filter((s) => !s.locked)) {
    must(await admin.from("sharing_settings").update({ shared: s.defaultShared }).eq("learner_id", learnerId).eq("item", s.item), "reset sharing");
  }

  must(
    await admin.from("family_links").upsert({ parent_id: parentId, learner_id: learnerId, relationship: "parent" }, { onConflict: "parent_id,learner_id" }),
    "link",
  );
  must(await admin.from("learner_profiles").upsert(toLearnerProfileRow(profile, learnerId)), "profile");
  const statusRows = Object.entries(outcomeMastery(profile.mastery)).map(([code, mastery]) => ({
    learner_id: learnerId,
    outcome_code: code,
    mastery,
    status: statusForMastery(mastery),
  }));
  must(await admin.from("outcome_status").insert(statusRows), "outcome status");

  // Proposal §3.3: Monday and Wednesday 7:00 pm, Saturday 10:00 am, 30 minutes each.
  must(
    await admin.from("schedules").insert([
      { learner_id: learnerId, weekday: 1, start_time: "19:00", duration_min: 30 },
      { learner_id: learnerId, weekday: 3, start_time: "19:00", duration_min: 30 },
      { learner_id: learnerId, weekday: 6, start_time: "10:00", duration_min: 30 },
    ]),
    "schedule",
  );

  // Scenario B goal. Alex accepts it during the demo (co-set).
  const deadline = scenarioBDeadline();
  must(
    await admin.from("reward_rules").insert({
      parent_id: parentId,
      learner_id: learnerId,
      outcomes: ["8PR1", "8PR2"],
      min_score: 0.85,
      retention_days: 7,
      deadline,
      reward_text: "Gift of the learner's choice",
      value: 50,
      currency: "CAD",
    }),
    "reward rule",
  );

  console.log("Demo family reset (synthetic data).");
  console.log(`  Parent login : ${PARENT.email}`);
  console.log(`  Learner login: ${LEARNER.username} (${LEARNER.displayName})`);
  console.log(
    passwordFromEnv
      ? "  Password     : the DEMO_PASSWORD from .env.local"
      : `  Password     : ${password}   (random; set DEMO_PASSWORD in .env.local to choose your own)`,
  );
  console.log(`  Outcomes     : ${statusRows.map((r) => `${r.outcome_code}=${r.status}`).join(", ")}`);
  console.log(`  Schedule     : Mon 19:00, Wed 19:00, Sat 10:00 (30 min)`);
  console.log(`  Reward goal  : 8PR1 + 8PR2, 85%, re-check after 7 days, by ${deadline}, 50 CAD`);
}

async function timeTravel() {
  const { learnerId } = await demoIds();
  const exits = must(
    await admin.from("assessments").select("id, taken_at, item_results").eq("learner_id", learnerId).eq("outcome_code", "8PR2").eq("kind", "exit"),
    "read assessments",
  ) as { id: string; taken_at: string; item_results: { mastered?: boolean } }[];
  if (!exits.some((e) => e.item_results.mastered)) {
    console.error("Alex has not reached 8PR2 yet. Finish the 8PR2 lesson with full marks first (scenario B, step 2).");
    process.exit(1);
  }
  const eightDaysAgo = new Date(Date.now() - 8 * DAY).toISOString();
  for (const e of exits) must(await admin.from("assessments").update({ taken_at: eightDaysAgo }).eq("id", e.id), "move assessment");
  must(await admin.from("outcome_status").update({ achieved_at: eightDaysAgo }).eq("learner_id", learnerId).eq("outcome_code", "8PR2"), "move status");

  // 8PR1 was reached in class three weeks ago and re-checked last week.
  must(
    await admin
      .from("outcome_status")
      .upsert(
        { learner_id: learnerId, outcome_code: "8PR1", status: "achieved", mastery: 0.9, achieved_at: new Date(Date.now() - 20 * DAY).toISOString() },
        { onConflict: "learner_id,outcome_code" },
      ),
    "8PR1 status",
  );
  must(await admin.from("assessments").delete().eq("learner_id", learnerId).eq("outcome_code", "8PR1"), "clear 8PR1");
  must(
    await admin.from("assessments").insert([
      { learner_id: learnerId, outcome_code: "8PR1", kind: "exit", score: 0.9, item_results: { mastered: true }, taken_at: new Date(Date.now() - 20 * DAY).toISOString() },
      { learner_id: learnerId, outcome_code: "8PR1", kind: "retention", score: 0.9, item_results: { mastered: true }, taken_at: new Date(Date.now() - 10 * DAY).toISOString() },
    ]),
    "8PR1 results",
  );
  console.log("A week has 'passed'. Alex's memory check for 8PR2 is ready on the learner home page.");
}

async function slotNow() {
  const { learnerId } = await demoIds();
  const start = localNow(new Date(Date.now() - 2 * 60_000));
  must(
    await admin.from("schedules").insert({ learner_id: learnerId, weekday: start.getDay(), start_time: format(start, "HH:mm"), duration_min: 60 }),
    "slot",
  );
  console.log(`Added a study slot today at ${format(start, "HH:mm")} St. John's time (60 min). Start the lesson now for scenario C.`);
}

const command = process.argv[2] ?? "reset";
const run = { reset, "time-travel": timeTravel, "slot-now": slotNow }[command];
if (!run) {
  console.error(`Unknown command "${command}". Use: reset | time-travel | slot-now`);
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error("Demo script failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
