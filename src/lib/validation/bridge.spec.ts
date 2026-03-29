import { describe, expect, it } from "vitest";
import {
  ClaimBridgeJobSchema,
  CompleteBridgeJobSchema,
  CreateBridgeJobSchema,
  FailBridgeJobSchema,
} from "@/lib/validation/bridge";

describe("bridge validation", () => {
  it("accepts a valid bridge job request", () => {
    for (const provider of ["chatgpt", "gemini", "claude"] as const) {
      const result = CreateBridgeJobSchema.safeParse({
        streamId: "123e4567-e89b-42d3-a456-426614174000",
        provider,
        payload: "<bridge />",
        payloadVariant: "full",
        sessionKey: `${provider}:stream-1`,
      });

      expect(result.success).toBe(true);
    }
  });

  it("rejects unsupported providers", () => {
    const result = CreateBridgeJobSchema.safeParse({
      streamId: "123e4567-e89b-42d3-a456-426614174000",
      provider: "perplexity",
      payload: "<bridge />",
      payloadVariant: "full",
      sessionKey: "perplexity:stream-1",
    });

    expect(result.success).toBe(false);
  });

  it("requires raw response content for completion", () => {
    expect(
      CompleteBridgeJobSchema.safeParse({
        rawResponse: "   ",
      }).success,
    ).toBe(false);
  });

  it("defaults claim requests to gemini", () => {
    const result = ClaimBridgeJobSchema.parse({});
    expect(result.provider).toBe("gemini");
  });

  it("requires a failure code and message", () => {
    expect(
      FailBridgeJobSchema.safeParse({
        errorCode: "",
        errorMessage: "",
      }).success,
    ).toBe(false);
  });
});
