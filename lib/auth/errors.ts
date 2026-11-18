import type { AuthErrorCode } from "./schemas";

/** Maps a Supabase Auth error to a short code the UI can translate. Never exposes raw messages. */
export function authErrorCode(error: { code?: string; status?: number } | null | undefined): AuthErrorCode {
  if (!error) return "unknown";
  switch (error.code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "user_already_exists":
    case "email_exists":
      return "email_taken";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate_limited";
  }
  if (error.status === 429) return "rate_limited";
  return "unknown";
}
