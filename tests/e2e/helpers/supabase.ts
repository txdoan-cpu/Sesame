import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { learnerEmail } from "@/lib/auth/schemas";

/** True when .env.local has the Supabase settings these tests need. */
export const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
}

export function anonClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
}

export function randomTag(): string {
  return Math.random().toString(36).slice(2, 8);
}

export const TEST_PASSWORD = "E2e-test-pass-123";

export type TestFamily = {
  parent: { id: string; email: string; name: string };
  learner: { id: string; username: string; name: string };
};

/** Creates a parent + learner + link with the service role (synthetic test data). */
export async function createFamily(admin: SupabaseClient, label: string): Promise<TestFamily> {
  const tag = randomTag();
  const parentEmail = `e2e-parent-${label}-${tag}@example.com`;
  const parentName = `Parent ${label} ${tag}`;
  const username = `e2e_${label}_${tag}`.toLowerCase();
  const learnerName = `Kid ${label} ${tag}`;

  const p = await admin.auth.admin.createUser({
    email: parentEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: parentName },
  });
  if (p.error || !p.data.user) throw new Error(`create parent: ${p.error?.message}`);

  const l = await admin.auth.admin.createUser({
    email: learnerEmail(username),
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "learner", username },
    user_metadata: { display_name: learnerName },
  });
  if (l.error || !l.data.user) {
    await deleteUsers(admin, [p.data.user.id]);
    throw new Error(`create learner: ${l.error?.message}`);
  }

  const link = await admin.from("family_links").insert({ parent_id: p.data.user.id, learner_id: l.data.user.id });
  if (link.error) {
    await deleteUsers(admin, [p.data.user.id, l.data.user.id]);
    throw new Error(`link: ${link.error.message}`);
  }

  return {
    parent: { id: p.data.user.id, email: parentEmail, name: parentName },
    learner: { id: l.data.user.id, username, name: learnerName },
  };
}

export function learnerEmailFor(family: TestFamily): string {
  return learnerEmail(family.learner.username);
}

export async function deleteUsers(admin: SupabaseClient, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => admin.auth.admin.deleteUser(id)));
}

export async function signedIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return client;
}
