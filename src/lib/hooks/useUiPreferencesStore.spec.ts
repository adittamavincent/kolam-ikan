import { beforeEach, describe, expect, it } from "vitest";
import {
  buildUiPreferencesPayload,
  useUiPreferencesStore,
} from "@/lib/hooks/useUiPreferencesStore";

function resetUiPreferencesStore() {
  useUiPreferencesStore.setState({
    deviceClass: "desktop",
    sidebarVisible: false,
    sidebarWidths: {
      mobile: 256,
      tablet: 256,
      desktop: 256,
    },
    isSidebarResizing: false,
    layoutMode: "balanced",
    layoutWidthsByDevice: {
      mobile: { log: 50, canvas: 50, previous: { log: 50, canvas: 50 } },
      tablet: { log: 50, canvas: 50, previous: { log: 50, canvas: 50 } },
      desktop: { log: 50, canvas: 50, previous: { log: 50, canvas: 50 } },
    },
    navigatorExpandedByDomain: {},
    logCollapsedItemIdsByStream: {},
    bridgeDefaults: {
      providerId: "gemini",
      quickPreset: "recommended",
    },
    bridgeSessionsByStream: {},
    localUpdatedAt: null,
    lastSyncedAt: null,
    cloudHydratedUserId: null,
    activeUserId: null,
    syncStatus: "idle",
  });
}

describe("useUiPreferencesStore", () => {
  beforeEach(() => {
    resetUiPreferencesStore();
  });

  it("stores sidebar widths per device class", () => {
    const state = useUiPreferencesStore.getState();

    state.setSidebarWidth(320);
    state.setDeviceClass("mobile");
    state.setSidebarWidth(220);

    const next = useUiPreferencesStore.getState();
    expect(next.sidebarWidths.desktop).toBe(320);
    expect(next.sidebarWidths.mobile).toBe(220);
  });

  it("applies cloud preferences without marking new local edits", () => {
    useUiPreferencesStore.getState().applyCloudPreferences(
      {
        global: {
          layout: { mode: "canvas-only" },
          sidebar: { visible: true },
        },
        device: {
          layoutWidths: {
            desktop: {
              log: 0,
              canvas: 100,
              previous: { log: 35, canvas: 65 },
            },
          },
          sidebarWidths: {
            desktop: 288,
          },
        },
        navigator: {
          expandedCabinetIdsByDomain: {
            pond: ["cab-2", "cab-1"],
          },
        },
        log: {
          collapsedItemIdsByStream: {
            stream_1: ["canvas_snapshot:snap-2", "entry:entry-1"],
          },
        },
        bridge: {
          defaults: {
            providerId: "claude",
            quickPreset: "recommended",
          },
          sessionsByStream: {
            stream_1: {
              providerId: "gemini",
              lastMode: "BOTH",
              lastContextRecipe: {
                entrySelection: "all",
                includeCanvas: true,
                includeGlobalStream: false,
              },
              lastInstruction: "Summarize the latest discussion",
              sessionMemory: "Recent both objective: Summarize the latest discussion",
              lastUsedAt: "2026-03-29T10:00:00.000Z",
              isExternalSessionActive: true,
              externalSessionLoadedAt: "2026-03-29T10:01:00.000Z",
              automationSessionKey: "gemini:stream_1",
              automationStatus: "succeeded",
              lastJobId: "job-1",
              lastAppliedJobId: null,
              lastJobStatus: "succeeded",
              lastJobError: "",
              lastJobCompletedAt: "2026-03-29T10:02:00.000Z",
            },
          },
        },
      },
      "user-1",
      1234,
    );

    const next = useUiPreferencesStore.getState();
    expect(next.sidebarVisible).toBe(true);
    expect(next.sidebarWidths.desktop).toBe(288);
    expect(next.layoutWidthsByDevice.desktop.log).toBe(0);
    expect(next.navigatorExpandedByDomain.pond).toEqual(["cab-1", "cab-2"]);
    expect(next.logCollapsedItemIdsByStream.stream_1).toEqual([
      "canvas_snapshot:snap-2",
      "entry:entry-1",
    ]);
    expect(next.bridgeDefaults.providerId).toBe("claude");
    expect(next.bridgeSessionsByStream.stream_1?.providerId).toBe("gemini");
    expect(next.lastSyncedAt).toBe(1234);
    expect(next.localUpdatedAt).toBeNull();
  });

  it("serializes a stable sync payload", () => {
    useUiPreferencesStore.setState({
      sidebarVisible: true,
      sidebarWidths: {
        mobile: 210,
        tablet: 260,
        desktop: 310,
      },
      navigatorExpandedByDomain: {
        pond: ["b", "a", "a"],
      },
      logCollapsedItemIdsByStream: {
        stream_1: ["entry:b", "entry:a", "entry:a"],
      },
      bridgeDefaults: {
        providerId: "claude",
        quickPreset: "recommended",
      },
      bridgeSessionsByStream: {
        stream_1: {
          providerId: "gemini",
          lastMode: "BOTH",
          lastContextRecipe: {
            entrySelection: "all",
            includeCanvas: true,
            includeGlobalStream: true,
          },
          lastInstruction: "Draft the protocol",
          sessionMemory: "Recent both objective: Draft the protocol",
          lastUsedAt: "2026-03-29T12:00:00.000Z",
          isExternalSessionActive: false,
          externalSessionLoadedAt: null,
          automationSessionKey: "gemini:stream_1",
          automationStatus: "queued",
          lastJobId: "job-2",
          lastAppliedJobId: null,
          lastJobStatus: "queued",
          lastJobError: "",
          lastJobCompletedAt: null,
        },
      },
    });

    expect(buildUiPreferencesPayload(useUiPreferencesStore.getState())).toEqual({
      global: {
        layout: { mode: "balanced" },
        sidebar: { visible: true },
      },
      device: {
        layoutWidths: {
          mobile: {
            log: 50,
            canvas: 50,
            previous: { log: 50, canvas: 50 },
          },
          tablet: {
            log: 50,
            canvas: 50,
            previous: { log: 50, canvas: 50 },
          },
          desktop: {
            log: 50,
            canvas: 50,
            previous: { log: 50, canvas: 50 },
          },
        },
        sidebarWidths: {
          mobile: 210,
          tablet: 260,
          desktop: 310,
        },
      },
      navigator: {
        expandedCabinetIdsByDomain: {
          pond: ["a", "b"],
        },
      },
      log: {
        collapsedItemIdsByStream: {
          stream_1: ["entry:a", "entry:b"],
        },
      },
      bridge: {
        defaults: {
          providerId: "claude",
          quickPreset: "recommended",
        },
        sessionsByStream: {
          stream_1: {
            providerId: "gemini",
            lastMode: "BOTH",
            lastContextRecipe: {
              entrySelection: "all",
              includeCanvas: true,
              includeGlobalStream: true,
            },
            lastInstruction: "Draft the protocol",
            sessionMemory: "Recent both objective: Draft the protocol",
            lastUsedAt: "2026-03-29T12:00:00.000Z",
            isExternalSessionActive: false,
            externalSessionLoadedAt: null,
            automationSessionKey: "gemini:stream_1",
            automationStatus: "queued",
            lastJobId: "job-2",
            lastAppliedJobId: null,
            lastJobStatus: "queued",
            lastJobError: "",
            lastJobCompletedAt: null,
          },
        },
      },
    });
  });

  it("stores bridge defaults and sessions", () => {
    const state = useUiPreferencesStore.getState();

    state.setBridgeDefaults({
      providerId: "claude",
    });
    state.upsertBridgeSession("stream_77", {
      providerId: "gemini",
      lastMode: "BOTH",
      lastInstruction: "Turn this into a concise spec",
      lastContextRecipe: {
        entrySelection: "all",
        includeCanvas: true,
        includeGlobalStream: false,
      },
      lastUsedAt: "2026-03-29T13:00:00.000Z",
      isExternalSessionActive: true,
      externalSessionLoadedAt: "2026-03-29T13:05:00.000Z",
      automationSessionKey: "gemini:stream_77",
      automationStatus: "running",
      lastJobId: "job-77",
      lastJobStatus: "running",
      lastJobError: "",
      lastJobCompletedAt: null,
    });

    const next = useUiPreferencesStore.getState();
    expect(next.bridgeDefaults.providerId).toBe("claude");
    expect(next.bridgeSessionsByStream.stream_77).toMatchObject({
      providerId: "gemini",
      lastInstruction: "Turn this into a concise spec",
      isExternalSessionActive: true,
    });
    expect(next.bridgeSessionsByStream.stream_77?.sessionMemory).toContain(
      "Recent both objective:",
    );
  });

  it("prunes stale collapsed log items for a stream", () => {
    useUiPreferencesStore.setState({
      logCollapsedItemIdsByStream: {
        stream_1: ["entry:a", "entry:b", "canvas_snapshot:c"],
      },
    });

    useUiPreferencesStore
      .getState()
      .pruneCollapsedLogItemsForStream("stream_1", ["entry:b", "canvas_snapshot:c"]);

    expect(useUiPreferencesStore.getState().logCollapsedItemIdsByStream.stream_1).toEqual([
      "entry:b",
      "canvas_snapshot:c",
    ]);
  });
});
