import { z } from "zod";

export const BridgePayloadVariantSchema = z.enum(["full", "followup"]);

export const CreateBridgeJobSchema = z.object({
  streamId: z.string().uuid(),
  provider: z.literal("gemini"),
  payload: z.string().trim().min(1),
  payloadVariant: BridgePayloadVariantSchema,
  sessionKey: z.string().trim().min(1).max(255),
  runnerDetails: z.record(z.string(), z.unknown()).optional(),
});

export const ClaimBridgeJobSchema = z.object({
  provider: z.literal("gemini").default("gemini"),
  runnerId: z.string().trim().min(1).max(255).optional(),
});

export const CompleteBridgeJobSchema = z.object({
  rawResponse: z.string().trim().min(1),
  runnerDetails: z.record(z.string(), z.unknown()).optional(),
});

export const FailBridgeJobSchema = z.object({
  errorCode: z.string().trim().min(1).max(100),
  errorMessage: z.string().trim().min(1),
  runnerDetails: z.record(z.string(), z.unknown()).optional(),
});
