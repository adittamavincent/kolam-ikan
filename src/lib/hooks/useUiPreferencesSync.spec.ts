import { describe, expect, it } from "vitest";
import {
  didBridgePhaseChange,
  shouldApplyFetchedPreferences,
} from "./useUiPreferencesSync";

describe("useUiPreferencesSync helpers", () => {
  it("applies fetched preferences when local changes are already synced", () => {
    expect(shouldApplyFetchedPreferences(200, 100, 100)).toBe(true);
  });

  it("does not overwrite newer unsynced local changes with older cloud data", () => {
    expect(shouldApplyFetchedPreferences(100, 200, 150)).toBe(false);
  });

  it("detects quick or detailed bridge phase changes", () => {
    expect(
      didBridgePhaseChange(
        {
          "stream-1": {
            providerId: "gemini",
            lastMode: "BOTH",
            lastContextRecipe: {
              entrySelection: "all",
              includeCanvas: true,
              includeGlobalStream: true,
            },
            lastInstruction: "",
            sessionMemory: "",
            lastUsedAt: null,
            isExternalSessionActive: false,
            externalSessionLoadedAt: null,
            externalSessionUrl: null,
            automationSessionKey: null,
            automationStatus: "idle",
            lastJobId: null,
            lastAppliedJobId: null,
            lastJobStatus: null,
            lastJobError: "",
            lastJobCompletedAt: null,
            sentEntryIds: [],
            quickUiPhase: "manual-paste",
            detailedUiPhase: "send",
          },
        },
        {
          "stream-1": {
            providerId: "gemini",
            lastMode: "BOTH",
            lastContextRecipe: {
              entrySelection: "all",
              includeCanvas: true,
              includeGlobalStream: true,
            },
            lastInstruction: "",
            sessionMemory: "",
            lastUsedAt: null,
            isExternalSessionActive: false,
            externalSessionLoadedAt: null,
            externalSessionUrl: null,
            automationSessionKey: null,
            automationStatus: "idle",
            lastJobId: null,
            lastAppliedJobId: null,
            lastJobStatus: null,
            lastJobError: "",
            lastJobCompletedAt: null,
            sentEntryIds: [],
            quickUiPhase: "manual-copy",
            detailedUiPhase: "send",
          },
        },
      ),
    ).toBe(true);
  });
});
