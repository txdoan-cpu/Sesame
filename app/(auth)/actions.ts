"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { homeFor } from "@/lib/auth/dal";
import { authErrorCode } from "@/lib/auth/errors";
import {
  learnerEmail,
  learnerLoginSchema,
  parentLoginSchema,
  parentSignUpSchema,
  type ActionState,
} from "@/lib/auth/schemas";
import { LANG_COOKIE, parseLang } from "@/lib/i18n";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signUpParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!supabaseEnv()) return { error: "not_configured" };
  const input = parentSignUpSchema.safeParse({
    displayName: field(formData, "displayName"),
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!input.success) return { error: "invalid_input" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.data.email,
    password: input.data.password,
    // Role is not taken from here: the database makes every public sign-up a parent.
    options: { data: { display_name: input.data.displayName } },
  });
  if (error) return { error: authErrorCode(error) };
  // With "Confirm email" on, Supabase hides existing accounts by returning a user with no identities.
  if (!data.session) return { error: data.user?.identities?.length === 0 ? "email_taken" : "unknown" };

  redirect("/parent");
}

export async function loginParent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!supabaseEnv()) return { error: "not_configured" };
  const input = parentLoginSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!input.success) return { error: "invalid_input" };
  return signInAndRedirect(input.data.email, input.data.password);
}

export async function loginLearner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!supabaseEnv()) return { error: "not_configured" };
  const input = learnerLoginSchema.safeParse({
    username: field(formData, "username"),
    password: field(formData, "password"),
  });
  if (!input.success) return { error: "invalid_input" };
  return signInAndRedirect(learnerEmail(input.data.username), input.data.password);
}

async function signInAndRedirect(email: string, password: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: authErrorCode(error) };

  // Same client now carries the new session, so RLS lets us read our own profile.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  redirect(profile?.role === "learner" ? homeFor("learner") : homeFor("parent"));
}

export async function logout(): Promise<void> {
  if (supabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function setLang(formData: FormData): Promise<void> {
  const lang = parseLang(field(formData, "lang"));
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
