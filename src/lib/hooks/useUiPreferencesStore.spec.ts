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
      },
      "user-1",
      1234,
    );

    const next = useUiPreferencesStore.getState();
    expect(next.sidebarVisible).toBe(true);
    expect(next.sidebarWidths.desktop).toBe(288);
    expect(next.layoutWidthsByDevice.desktop.log).toBe(0);
    expect(next.navigatorExpandedByDomain.pond).toEqual(["cab-1", "cab-2"]);
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
    });
  });
});
