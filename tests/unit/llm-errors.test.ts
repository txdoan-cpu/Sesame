import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { describeClaudeError } from "@/lib/llm/errors";

const headers = new Headers();
const body = (type: string, message: string) => ({ type: "error", error: { type, message } });

describe("describeClaudeError", () => {
  it("maps 401 to invalid_key", () => {
    const err = Anthropic.APIError.generate(401, body("authentication_error", "invalid x-api-key"), undefined, headers);
    expect(describeClaudeError(err).code).toBe("invalid_key");
  });

  it("maps billing_error to no_credit", () => {
    const err = Anthropic.APIError.generate(402, body("billing_error", "no credit"), undefined, headers);
    expect(describeClaudeError(err).code).toBe("no_credit");
  });

  it("maps a low-credit 400 to no_credit", () => {
    const err = Anthropic.APIError.generate(
      400,
      body("invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
      undefined,
      headers,
    );
    expect(describeClaudeError(err).code).toBe("no_credit");
  });

  it("maps 404 to model_not_found", () => {
    const err = Anthropic.APIError.generate(404, body("not_found_error", "model: nope"), undefined, headers);
    expect(describeClaudeError(err).code).toBe("model_not_found");
  });

  it("maps connection failures to network", () => {
    const err = new Anthropic.APIConnectionError({ message: "fetch failed" });
    expect(describeClaudeError(err).code).toBe("network");
  });

  it("never echoes the raw error text (which could contain request details)", () => {
    const secret = "sk-ant-should-never-appear";
    const err = Anthropic.APIError.generate(500, body("api_error", secret), undefined, headers);
    expect(describeClaudeError(err).error).not.toContain(secret);
  });
});
