"use server";

import { refresh } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/dal";
import { createLearnerSchema, learnerEmail, type ActionState } from "@/lib/auth/schemas";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * A signed-in parent creates a learner account (username + password) and is
 * linked to it. Runs with the service role, so the parent check comes first.
 */
export async function createLearner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parent = await getCurrentUser();
  if (!parent || parent.role !== "parent") return { error: "invalid_credentials" };

  const input = createLearnerSchema.safeParse({
    displayName: field(formData, "displayName"),
    username: field(formData, "username"),
    password: field(formData, "password"),
  });
  if (!input.success) return { error: "invalid_input" };
  const { displayName, username, password } = input.data;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "not_configured" };
  }

  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return { error: "username_taken" };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: learnerEmail(username),
    password,
    email_confirm: true,
    // app_metadata can only be set by the service role; the profile trigger reads role from here.
    app_metadata: { role: "learner", username },
    user_metadata: { display_name: displayName },
  });
  if (createError || !created.user) {
    return { error: createError?.code === "email_exists" ? "username_taken" : "unknown" };
  }

  const { error: linkError } = await admin
    .from("family_links")
    .insert({ parent_id: parent.id, learner_id: created.user.id, relationship: "parent" });
  if (linkError) {
    // Do not leave an orphan learner account behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "unknown" };
  }

  refresh();
  return { ok: true };
}
