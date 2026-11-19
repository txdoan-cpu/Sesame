/**
 * Creates (or resets) the first admin account (CLAUDE.md §4, owner decision Round 8).
 *
 *   npm run admin:create -- admin@example.ca
 *
 * The password comes from ADMIN_PASSWORD in .env.local (at least 8 characters);
 * it is never printed. Admins then create teacher accounts at /admin.
 */
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const email = (process.argv[2] ?? "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: npm run admin:create -- <email>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Set ADMIN_PASSWORD (at least 8 characters) in .env.local first.");
  process.exit(1);
}
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(target: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
}

async function main() {
  const existing = await findUser(email);
  if (existing) {
    const role = (existing.app_metadata as { role?: string }).role;
    if (role === "parent" || role === "learner") {
      console.error("This email belongs to a family account. Use another email for the admin.");
      process.exit(1);
    }
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password, app_metadata: { role: "admin" } });
    if (error) throw error;
    console.log(`Admin updated: ${email} (password set from ADMIN_PASSWORD).`);
    return;
  }
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "admin" },
    user_metadata: { display_name: "Admin" },
  });
  if (error) throw error;
  console.log(`Admin created: ${email} (password from ADMIN_PASSWORD). Log in at /login, then open /admin.`);
}

main().catch((e: unknown) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
