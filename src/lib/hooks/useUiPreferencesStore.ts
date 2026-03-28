"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiDeviceClass = "mobile" | "tablet" | "desktop";
export type UiSyncStatus = "idle" | "syncing" | "synced" | "error";
export type LayoutMode = "log-only" | "balanced" | "canvas-only";

export interface DeviceLayoutWidths {
  log: number;
  canvas: number;
  previous: { log: number; canvas: number };
}

export interface UiPreferencesPayload {
  global: {
    layout: {
      mode: LayoutMode;
    };
    sidebar: {
      visible: boolean;
    };
  };
  device: {
    layoutWidths: Partial<Record<UiDeviceClass, DeviceLayoutWidths>>;
    sidebarWidths: Partial<Record<UiDeviceClass, number>>;
  };
  navigator: {
    expandedCabinetIdsByDomain: Record<string, string[]>;
  };
}

interface UiPreferencesStoreState {
  deviceClass: UiDeviceClass;
  sidebarVisible: boolean;
  sidebarWidths: Record<UiDeviceClass, number>;
  isSidebarResizing: boolean;
  layoutMode: LayoutMode;
  layoutWidthsByDevice: Record<UiDeviceClass, DeviceLayoutWidths>;
  navigatorExpandedByDomain: Record<string, string[]>;
  localUpdatedAt: number | null;
  lastSyncedAt: number | null;
  cloudHydratedUserId: string | null;
  activeUserId: string | null;
  syncStatus: UiSyncStatus;
  setDeviceClass: (deviceClass: UiDeviceClass) => void;
  showSidebar: () => void;
  hideSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarResizing: (isResizing: boolean) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setCustomLayoutWidths: (logWidth: number, canvasWidth: number) => void;
  toggleLogCollapse: () => void;
  setExpandedCabinetsForDomain: (domainId: string, ids: Iterable<string>) => void;
  addExpandedCabinet: (domainId: string, cabinetId: string) => void;
  removeExpandedCabinet: (domainId: string, cabinetId: string) => void;
  toggleExpandedCabinet: (domainId: string, cabinetId: string) => void;
  setActiveUser: (userId: string | null) => void;
  setCloudHydrated: (userId: string | null) => void;
  setSyncStatus: (status: UiSyncStatus) => void;
  markSynced: (timestampMs: number, userId: string) => void;
  applyCloudPreferences: (
    payload: UiPreferencesPayload,
    userId: string,
    timestampMs: number,
  ) => void;
}

const DEFAULT_SIDEBAR_WIDTH = 256;
const DEFAULT_LAYOUT_WIDTHS: DeviceLayoutWidths = {
  log: 50,
  canvas: 50,
  previous: { log: 50, canvas: 50 },
};

function cloneLayoutWidths(widths: DeviceLayoutWidths): DeviceLayoutWidths {
  return {
    log: widths.log,
    canvas: widths.canvas,
    previous: {
      log: widths.previous.log,
      canvas: widths.previous.canvas,
    },
  };
}

function createDefaultLayoutWidths() {
  return {
    mobile: cloneLayoutWidths(DEFAULT_LAYOUT_WIDTHS),
    tablet: cloneLayoutWidths(DEFAULT_LAYOUT_WIDTHS),
    desktop: cloneLayoutWidths(DEFAULT_LAYOUT_WIDTHS),
  } satisfies Record<UiDeviceClass, DeviceLayoutWidths>;
}

function createDefaultSidebarWidths() {
  return {
    mobile: DEFAULT_SIDEBAR_WIDTH,
    tablet: DEFAULT_SIDEBAR_WIDTH,
    desktop: DEFAULT_SIDEBAR_WIDTH,
  } satisfies Record<UiDeviceClass, number>;
}

function toSortedUniqueIds(ids: Iterable<string>) {
  return [...new Set(ids)].sort();
}

function nextTimestamp() {
  return Date.now();
}

function touchLocalState<T extends Partial<UiPreferencesStoreState>>(
  partial: T,
): T & Pick<UiPreferencesStoreState, "localUpdatedAt"> {
  return {
    ...partial,
    localUpdatedAt: nextTimestamp(),
  };
}

export function getDeviceClassForWidth(width: number): UiDeviceClass {
  if (width < 768) return "mobile";
  if (width < 1280) return "tablet";
  return "desktop";
}

export function buildUiPreferencesPayload(
  state: Pick<
    UiPreferencesStoreState,
    | "layoutMode"
    | "layoutWidthsByDevice"
    | "sidebarVisible"
    | "sidebarWidths"
    | "navigatorExpandedByDomain"
  >,
): UiPreferencesPayload {
  return {
    global: {
      layout: {
        mode: state.layoutMode,
      },
      sidebar: {
        visible: state.sidebarVisible,
      },
    },
    device: {
      layoutWidths: {
        mobile: cloneLayoutWidths(state.layoutWidthsByDevice.mobile),
        tablet: cloneLayoutWidths(state.layoutWidthsByDevice.tablet),
        desktop: cloneLayoutWidths(state.layoutWidthsByDevice.desktop),
      },
      sidebarWidths: {
        mobile: state.sidebarWidths.mobile,
        tablet: state.sidebarWidths.tablet,
        desktop: state.sidebarWidths.desktop,
      },
    },
    navigator: {
      expandedCabinetIdsByDomain: Object.fromEntries(
        Object.entries(state.navigatorExpandedByDomain).map(([domainId, ids]) => [
          domainId,
          toSortedUniqueIds(ids),
        ]),
      ),
    },
  };
}

function mergePayloadIntoState(
  current: UiPreferencesStoreState,
  payload: UiPreferencesPayload,
): Partial<UiPreferencesStoreState> {
  const nextLayoutWidths = createDefaultLayoutWidths();
  const nextSidebarWidths = createDefaultSidebarWidths();

  for (const device of ["mobile", "tablet", "desktop"] as UiDeviceClass[]) {
    nextLayoutWidths[device] = cloneLayoutWidths(
      payload.device.layoutWidths[device] ?? current.layoutWidthsByDevice[device],
    );
    nextSidebarWidths[device] =
      payload.device.sidebarWidths[device] ?? current.sidebarWidths[device];
  }

  return {
    layoutMode: payload.global.layout.mode ?? current.layoutMode,
    sidebarVisible: payload.global.sidebar.visible ?? current.sidebarVisible,
    layoutWidthsByDevice: nextLayoutWidths,
    sidebarWidths: nextSidebarWidths,
    navigatorExpandedByDomain: Object.fromEntries(
      Object.entries(payload.navigator.expandedCabinetIdsByDomain ?? {}).map(
        ([domainId, ids]) => [domainId, toSortedUniqueIds(ids)],
      ),
    ),
  };
}

function currentLayoutWidths(state: UiPreferencesStoreState) {
  return state.layoutWidthsByDevice[state.deviceClass];
}

export const useUiPreferencesStore = create<UiPreferencesStoreState>()(
  persist(
    (set, get) => ({
      deviceClass: "desktop",
      sidebarVisible: false,
      sidebarWidths: createDefaultSidebarWidths(),
      isSidebarResizing: false,
      layoutMode: "balanced",
      layoutWidthsByDevice: createDefaultLayoutWidths(),
      navigatorExpandedByDomain: {},
      localUpdatedAt: null,
      lastSyncedAt: null,
      cloudHydratedUserId: null,
      activeUserId: null,
      syncStatus: "idle",
      setDeviceClass: (deviceClass) => {
        set((state) => (state.deviceClass === deviceClass ? state : { deviceClass }));
      },
      showSidebar: () => {
        set((state) =>
          state.sidebarVisible ? state : touchLocalState({ sidebarVisible: true }),
        );
      },
      hideSidebar: () => {
        set((state) =>
          !state.sidebarVisible ? state : touchLocalState({ sidebarVisible: false }),
        );
      },
      setSidebarVisible: (visible) => {
        set((state) =>
          state.sidebarVisible === visible
            ? state
            : touchLocalState({ sidebarVisible: visible }),
        );
      },
      setSidebarWidth: (width) => {
        set((state) => {
          const deviceClass = state.deviceClass;
          if (state.sidebarWidths[deviceClass] === width) return state;
          return touchLocalState({
            sidebarWidths: {
              ...state.sidebarWidths,
              [deviceClass]: width,
            },
          });
        });
      },
      setSidebarResizing: (isResizing) => {
        set((state) =>
          state.isSidebarResizing === isResizing
            ? state
            : { isSidebarResizing: isResizing },
        );
      },
      setLayoutMode: (mode) => {
        set((state) => {
          const widths = {
            "log-only": { log: 100, canvas: 0 },
            balanced: { log: 50, canvas: 50 },
            "canvas-only": { log: 0, canvas: 100 },
          };
          const deviceClass = state.deviceClass;
          return touchLocalState({
            layoutMode: mode,
            layoutWidthsByDevice: {
              ...state.layoutWidthsByDevice,
              [deviceClass]: {
                log: widths[mode].log,
                canvas: widths[mode].canvas,
                previous: widths[mode],
              },
            },
          });
        });
      },
      setCustomLayoutWidths: (logWidth, canvasWidth) => {
        set((state) => {
          const deviceClass = state.deviceClass;
          const current = state.layoutWidthsByDevice[deviceClass];
          if (
            current.log === logWidth &&
            current.canvas === canvasWidth &&
            current.previous.log === logWidth &&
            current.previous.canvas === canvasWidth &&
            state.layoutMode === "balanced"
          ) {
            return state;
          }
          return touchLocalState({
            layoutMode: "balanced",
            layoutWidthsByDevice: {
              ...state.layoutWidthsByDevice,
              [deviceClass]: {
                log: logWidth,
                canvas: canvasWidth,
                previous: { log: logWidth, canvas: canvasWidth },
              },
            },
          });
        });
      },
      toggleLogCollapse: () => {
        set((state) => {
          const deviceClass = state.deviceClass;
          const current = currentLayoutWidths(state);
          if (current.log > 0) {
            return touchLocalState({
              layoutMode: "canvas-only",
              layoutWidthsByDevice: {
                ...state.layoutWidthsByDevice,
                [deviceClass]: {
                  log: 0,
                  canvas: 100,
                  previous: {
                    log: current.log,
                    canvas: current.canvas,
                  },
                },
              },
            });
          }

          const next = current.previous ?? { log: 50, canvas: 50 };
          return touchLocalState({
            layoutMode:
              next.log === 0
                ? "canvas-only"
                : next.canvas === 0
                  ? "log-only"
                  : "balanced",
            layoutWidthsByDevice: {
              ...state.layoutWidthsByDevice,
              [deviceClass]: {
                log: next.log,
                canvas: next.canvas,
                previous: {
                  log: next.log,
                  canvas: next.canvas,
                },
              },
            },
          });
        });
      },
      setExpandedCabinetsForDomain: (domainId, ids) => {
        set((state) => {
          const nextIds = toSortedUniqueIds(ids);
          const currentIds = state.navigatorExpandedByDomain[domainId] ?? [];
          if (JSON.stringify(currentIds) === JSON.stringify(nextIds)) {
            return state;
          }
          return touchLocalState({
            navigatorExpandedByDomain: {
              ...state.navigatorExpandedByDomain,
              [domainId]: nextIds,
            },
          });
        });
      },
      addExpandedCabinet: (domainId, cabinetId) => {
        set((state) => {
          const currentIds = state.navigatorExpandedByDomain[domainId] ?? [];
          if (currentIds.includes(cabinetId)) return state;
          return touchLocalState({
            navigatorExpandedByDomain: {
              ...state.navigatorExpandedByDomain,
              [domainId]: toSortedUniqueIds([...currentIds, cabinetId]),
            },
          });
        });
      },
      removeExpandedCabinet: (domainId, cabinetId) => {
        set((state) => {
          const currentIds = state.navigatorExpandedByDomain[domainId] ?? [];
          if (!currentIds.includes(cabinetId)) return state;
          return touchLocalState({
            navigatorExpandedByDomain: {
              ...state.navigatorExpandedByDomain,
              [domainId]: currentIds.filter((id) => id !== cabinetId),
            },
          });
        });
      },
      toggleExpandedCabinet: (domainId, cabinetId) => {
        const state = get();
        if ((state.navigatorExpandedByDomain[domainId] ?? []).includes(cabinetId)) {
          get().removeExpandedCabinet(domainId, cabinetId);
          return;
        }
        get().addExpandedCabinet(domainId, cabinetId);
      },
      setActiveUser: (userId) => {
        set((state) => {
          if (state.activeUserId === userId) return state;
          return {
            activeUserId: userId,
            cloudHydratedUserId:
              state.cloudHydratedUserId === userId ? userId : null,
            lastSyncedAt:
              state.cloudHydratedUserId === userId ? state.lastSyncedAt : null,
            syncStatus: "idle",
          };
        });
      },
      setCloudHydrated: (userId) => {
        set((state) =>
          state.cloudHydratedUserId === userId ? state : { cloudHydratedUserId: userId },
        );
      },
      setSyncStatus: (status) => {
        set((state) => (state.syncStatus === status ? state : { syncStatus: status }));
      },
      markSynced: (timestampMs, userId) => {
        set({
          lastSyncedAt: timestampMs,
          cloudHydratedUserId: userId,
          activeUserId: userId,
          syncStatus: "synced",
        });
      },
      applyCloudPreferences: (payload, userId, timestampMs) => {
        set((state) => ({
          ...mergePayloadIntoState(state, payload),
          lastSyncedAt: timestampMs,
          cloudHydratedUserId: userId,
          activeUserId: userId,
          syncStatus: "idle",
        }));
      },
    }),
    {
      name: "kolam-ui-preferences",
      partialize: (state) => ({
        deviceClass: state.deviceClass,
        sidebarVisible: state.sidebarVisible,
        sidebarWidths: state.sidebarWidths,
        layoutMode: state.layoutMode,
        layoutWidthsByDevice: state.layoutWidthsByDevice,
        navigatorExpandedByDomain: state.navigatorExpandedByDomain,
        localUpdatedAt: state.localUpdatedAt,
        lastSyncedAt: state.lastSyncedAt,
        cloudHydratedUserId: state.cloudHydratedUserId,
        activeUserId: state.activeUserId,
      }),
    },
  ),
);
