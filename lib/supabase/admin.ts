import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv, SupabaseNotConfiguredError } from "./env";

/**
 * Service-role client. Bypasses RLS, so use it only in server code after
 * checking that the signed-in user is allowed to do the action.
 */
export function createAdminClient() {
  const env = supabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env || !serviceKey) throw new SupabaseNotConfiguredError();
  return createSupabaseClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
