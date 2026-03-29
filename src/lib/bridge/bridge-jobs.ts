import type { BridgeJob, BridgeJobStatus } from "@/lib/types";
import { z } from "zod";
import type { BridgeJobProvider } from "@/lib/bridge/providers";

export const SIDE_CAR_LOGIN_ERROR_CODE = "LOGIN_REQUIRED";
export const SIDE_CAR_SESSION_RESET_ERROR_CODE = "SESSION_RESET_REQUIRED";

export function buildBridgeSessionKey(
  streamId: string,
  provider: BridgeJobProvider,
) {
  return `${provider}:${streamId}`;
}

export function mapBridgeJobToRunnerStatus(job: {
  status: BridgeJobStatus;
  error_code?: string | null;
} | null | undefined): BridgeRunnerStatus {
  if (!job) return "idle";
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "succeeded") return "succeeded";
  if (
    job.status === "failed" &&
    job.error_code === SIDE_CAR_LOGIN_ERROR_CODE
  ) {
    return "needs-login";
  }
  return job.status === "failed" ? "failed" : "idle";
}

export function deriveBridgeSessionPatchFromJob(
  job: BridgeJob | null | undefined,
  currentActive = false,
) {
  if (!job) {
    return {
      automationStatus: "idle" as const,
      lastJobId: null,
      lastJobStatus: null,
      lastJobError: "",
      lastJobCompletedAt: null,
    };
  }

  const jobStatus = job.status as BridgeJobStatus;
  const runnerStatus = mapBridgeJobToRunnerStatus({
    status: jobStatus,
    error_code: job.error_code,
  });
  const shouldDeactivate =
    jobStatus === "failed" &&
    (job.error_code === SIDE_CAR_LOGIN_ERROR_CODE ||
      job.error_code === SIDE_CAR_SESSION_RESET_ERROR_CODE);

  const pageUrl =
    job.runner_details &&
    typeof job.runner_details === "object" &&
    !Array.isArray(job.runner_details) &&
    typeof job.runner_details.pageUrl === "string"
      ? job.runner_details.pageUrl
      : null;

  const nextPatch = {
    automationSessionKey: job.session_key,
    automationStatus: runnerStatus,
    lastJobId: job.id,
    lastJobStatus: jobStatus,
    lastJobError: job.error_message ?? "",
    lastJobCompletedAt: job.completed_at,
    externalSessionUrl: pageUrl,
    isExternalSessionActive:
      jobStatus === "succeeded"
        ? true
        : shouldDeactivate
          ? false
          : currentActive,
  };

  if (jobStatus === "succeeded") {
    return {
      ...nextPatch,
      externalSessionLoadedAt: job.completed_at ?? new Date().toISOString(),
    };
  }

  if (shouldDeactivate) {
    return {
      ...nextPatch,
      externalSessionLoadedAt: null,
    };
  }

  return nextPatch;
}

export type BridgeRunnerStatus =
  | "idle"
  | "queued"
  | "running"
  | "needs-login"
  | "succeeded"
  | "failed";

export const BridgeRunnerStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "needs-login",
  "succeeded",
  "failed",
]);
