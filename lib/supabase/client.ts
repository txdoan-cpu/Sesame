import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv, SupabaseNotConfiguredError } from "./env";

/** Supabase client for Client Components. Uses only the public anon key. */
export function createClient() {
  const env = supabaseEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return createBrowserClient(env.url, env.anonKey);
}
