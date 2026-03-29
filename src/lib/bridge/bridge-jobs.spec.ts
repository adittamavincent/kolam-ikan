import { describe, expect, it } from "vitest";
import {
  SIDE_CAR_LOGIN_ERROR_CODE,
  SIDE_CAR_SESSION_RESET_ERROR_CODE,
  deriveBridgeSessionPatchFromJob,
  mapBridgeJobToRunnerStatus,
} from "@/lib/bridge/bridge-jobs";
import type { BridgeJob } from "@/lib/types";

function createJob(partial: Partial<BridgeJob>): BridgeJob {
  return {
    id: "job-1",
    stream_id: "stream-1",
    created_by: "user-1",
    provider: "gemini",
    payload: "<prompt />",
    payload_variant: "full",
    status: "queued",
    session_key: "gemini:stream-1",
    attempt_count: 1,
    runner_id: "runner-1",
    runner_details: {},
    raw_response: null,
    error_code: null,
    error_message: null,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-03-29T10:00:00.000Z",
    updated_at: "2026-03-29T10:00:00.000Z",
    ...partial,
  };
}

describe("bridge job status mapping", () => {
  it("maps login failures to needs-login", () => {
    expect(
      mapBridgeJobToRunnerStatus({
        status: "failed",
        error_code: SIDE_CAR_LOGIN_ERROR_CODE,
      }),
    ).toBe("needs-login");
  });

  it("keeps succeeded jobs active in the session patch", () => {
    const patch = deriveBridgeSessionPatchFromJob(
      createJob({
        status: "succeeded",
        raw_response: "<response />",
        completed_at: "2026-03-29T10:05:00.000Z",
      }),
      false,
    );

    expect(patch.automationStatus).toBe("succeeded");
    expect("isExternalSessionActive" in patch && patch.isExternalSessionActive).toBe(
      true,
    );
    expect(
      "externalSessionLoadedAt" in patch && patch.externalSessionLoadedAt,
    ).toBe("2026-03-29T10:05:00.000Z");
  });

  it("clears active status when login or session reset is required", () => {
    const loginPatch = deriveBridgeSessionPatchFromJob(
      createJob({
        status: "failed",
        error_code: SIDE_CAR_LOGIN_ERROR_CODE,
        error_message: "Please log in again",
      }),
      true,
    );
    const resetPatch = deriveBridgeSessionPatchFromJob(
      createJob({
        status: "failed",
        error_code: SIDE_CAR_SESSION_RESET_ERROR_CODE,
        error_message: "Session reset required",
      }),
      true,
    );

    expect(
      "isExternalSessionActive" in loginPatch &&
        loginPatch.isExternalSessionActive,
    ).toBe(false);
    expect(
      "externalSessionLoadedAt" in loginPatch &&
        loginPatch.externalSessionLoadedAt,
    ).toBeNull();
    expect(
      "isExternalSessionActive" in resetPatch &&
        resetPatch.isExternalSessionActive,
    ).toBe(false);
    expect(
      "externalSessionLoadedAt" in resetPatch &&
        resetPatch.externalSessionLoadedAt,
    ).toBeNull();
  });
});
