import { describe, expect, it } from "vitest";
import {
  createLearnerSchema,
  learnerEmail,
  LEARNER_EMAIL_DOMAIN,
  parentSignUpSchema,
  usernameSchema,
} from "@/lib/auth/schemas";
import { authErrorCode } from "@/lib/auth/errors";

describe("learner usernames", () => {
  it("normalises case and spaces", () => {
    expect(usernameSchema.parse("  Sam_8 ")).toBe("sam_8");
  });

  it.each(["ab", "a".repeat(21), "sam-8", "sam 8", "sam@x", ""])("rejects %j", (bad) => {
    expect(usernameSchema.safeParse(bad).success).toBe(false);
  });

  it("maps to an internal address on a reserved domain", () => {
    expect(learnerEmail("Sam_8")).toBe(`sam_8@${LEARNER_EMAIL_DOMAIN}`);
    expect(LEARNER_EMAIL_DOMAIN.endsWith(".invalid")).toBe(true);
  });
});

describe("form schemas", () => {
  it("accepts a valid parent sign-up and lowercases email", () => {
    const r = parentSignUpSchema.parse({ displayName: " Lan ", email: "Lan@Example.com ", password: "12345678" });
    expect(r).toEqual({ displayName: "Lan", email: "lan@example.com", password: "12345678" });
  });

  it("rejects short passwords and bad emails", () => {
    expect(parentSignUpSchema.safeParse({ displayName: "Lan", email: "x@y.com", password: "short" }).success).toBe(false);
    expect(parentSignUpSchema.safeParse({ displayName: "Lan", email: "not-an-email", password: "12345678" }).success).toBe(false);
  });

  it("requires a child name", () => {
    expect(createLearnerSchema.safeParse({ displayName: "  ", username: "sam", password: "12345678" }).success).toBe(false);
  });
});

describe("authErrorCode", () => {
  it("maps known Supabase codes and hides the rest", () => {
    expect(authErrorCode({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(authErrorCode({ code: "user_already_exists" })).toBe("email_taken");
    expect(authErrorCode({ code: "over_request_rate_limit" })).toBe("rate_limited");
    expect(authErrorCode({ status: 429 })).toBe("rate_limited");
    expect(authErrorCode({ code: "something_new" })).toBe("unknown");
    expect(authErrorCode(null)).toBe("unknown");
  });
});
