import { z } from "zod";

/**
 * Learners sign in with a username. Supabase Auth needs an email, so each
 * username maps to an internal address on a reserved domain (.invalid) that
 * can never receive mail.
 */
export const LEARNER_EMAIL_DOMAIN = "learners.sesame.invalid";

export function learnerEmail(username: string): string {
  return `${normalizeUsername(username)}@${LEARNER_EMAIL_DOMAIN}`;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/, "username"));

export const passwordSchema = z.string().min(8, "password").max(72, "password");

export const displayNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "displayName").max(60, "displayName"));

export const parentSignUpSchema = z.object({
  displayName: displayNameSchema,
  email: z.string().trim().toLowerCase().pipe(z.email("email")),
  password: passwordSchema,
});

export const parentLoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("email")),
  password: z.string().min(1, "password"),
});

export const learnerLoginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "password"),
});

export const createLearnerSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
});

/** Error codes returned by auth actions; the UI maps them to translated text. */
export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_taken"
  | "username_taken"
  | "not_configured"
  | "rate_limited"
  | "unknown";

export type ActionState = { error?: AuthErrorCode; ok?: boolean };
