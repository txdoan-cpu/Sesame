import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseEnv, SupabaseNotConfiguredError } from "./env";

/** Supabase client for Server Components, Route Handlers and Server Actions (acts as the signed-in user, RLS applies). */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  // supabase-js reads the clock (token expiry), so keep this out of prerendering.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session cookie before the page renders.
        }
      },
    },
  });
}
