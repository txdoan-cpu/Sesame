/**
 * Creates (or refreshes) the demo family on the linked Supabase project:
 * a parent account, learner demo-A, their link, the §9 learner profile and
 * starting outcome status. Synthetic data only. Safe to run again.
 *
 *   npm run seed:demo
 *
 * Password: DEMO_PASSWORD from .env.local, or a random one printed once.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  LearnerProfileSchema,
  outcomeMastery,
  statusForMastery,
  toLearnerProfileRow,
} from "../lib/learner-profile.ts";

nextEnv.loadEnvConfig(process.cwd());

const DEMO_PARENT = { email: "parent.demo@example.com", displayName: "Demo Parent" };
const DEMO_LEARNER = { username: "demo_a", displayName: "Alex" };
const LEARNER_EMAIL = `${DEMO_LEARNER.username}@learners.sesame.invalid`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const passwordFromEnv = process.env.DEMO_PASSWORD?.trim();
const password = passwordFromEnv || `demo-${randomBytes(6).toString("base64url")}`;
if (password.length < 8) {
  console.error("DEMO_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
}

async function upsertUser(
  email: string,
  displayName: string,
  appMetadata: Record<string, string> | undefined,
): Promise<string> {
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

async function main() {
  const profile = LearnerProfileSchema.parse(
    JSON.parse(readFileSync(new URL("../content/profiles/demo-A.json", import.meta.url), "utf8")),
  );

  const parentId = await upsertUser(DEMO_PARENT.email, DEMO_PARENT.displayName, undefined);
  const learnerId = await upsertUser(LEARNER_EMAIL, DEMO_LEARNER.displayName, {
    role: "learner",
    username: DEMO_LEARNER.username,
  });

  const link = await admin
    .from("family_links")
    .upsert({ parent_id: parentId, learner_id: learnerId, relationship: "parent" }, { onConflict: "parent_id,learner_id" });
  if (link.error) throw link.error;

  const prof = await admin.from("learner_profiles").upsert(toLearnerProfileRow(profile, learnerId));
  if (prof.error) throw prof.error;

  const statusRows = Object.entries(outcomeMastery(profile.mastery)).map(([code, mastery]) => ({
    learner_id: learnerId,
    outcome_code: code,
    mastery,
    status: statusForMastery(mastery),
    updated_at: new Date().toISOString(),
  }));
  const status = await admin.from("outcome_status").upsert(statusRows, { onConflict: "learner_id,outcome_code" });
  if (status.error) throw status.error;

  console.log("Demo family ready (synthetic data).");
  console.log(`  Parent login : ${DEMO_PARENT.email}`);
  console.log(`  Learner login: ${DEMO_LEARNER.username}`);
  console.log(
    passwordFromEnv
      ? "  Password     : the DEMO_PASSWORD from .env.local"
      : `  Password     : ${password}   (random; set DEMO_PASSWORD in .env.local to choose your own)`,
  );
  console.log(`  Outcome status: ${statusRows.map((r) => `${r.outcome_code}=${r.status}`).join(", ")}`);
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
