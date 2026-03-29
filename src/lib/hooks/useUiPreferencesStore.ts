"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiDeviceClass = "mobile" | "tablet" | "desktop";
export type UiSyncStatus = "idle" | "syncing" | "synced" | "error";
export type LayoutMode = "log-only" | "balanced" | "canvas-only";
export type BridgeProviderId = "chatgpt" | "gemini" | "claude";
export type BridgeInteractionMode = "ASK" | "GO" | "BOTH";
export type BridgeQuickPresetId = "recommended";

export interface BridgeContextRecipe {
  entrySelection: "all" | "last-5";
  includeCanvas: boolean;
  includeGlobalStream: boolean;
}

export interface BridgeStreamSession {
  providerId: BridgeProviderId;
  lastMode: BridgeInteractionMode;
  lastContextRecipe: BridgeContextRecipe;
  lastInstruction: string;
  sessionMemory: string;
  lastUsedAt: string | null;
  isExternalSessionActive: boolean;
  externalSessionLoadedAt: string | null;
}

export interface BridgePreferencesPayload {
  defaults: {
    providerId: BridgeProviderId;
    quickPreset: BridgeQuickPresetId;
  };
  sessionsByStream: Record<string, BridgeStreamSession>;
}

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
  log: {
    collapsedItemIdsByStream: Record<string, string[]>;
  };
  bridge: BridgePreferencesPayload;
}

interface UiPreferencesStoreState {
  deviceClass: UiDeviceClass;
  sidebarVisible: boolean;
  sidebarWidths: Record<UiDeviceClass, number>;
  isSidebarResizing: boolean;
  layoutMode: LayoutMode;
  layoutWidthsByDevice: Record<UiDeviceClass, DeviceLayoutWidths>;
  navigatorExpandedByDomain: Record<string, string[]>;
  logCollapsedItemIdsByStream: Record<string, string[]>;
  bridgeDefaults: BridgePreferencesPayload["defaults"];
  bridgeSessionsByStream: Record<string, BridgeStreamSession>;
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
  setCollapsedLogItemsForStream: (streamId: string, ids: Iterable<string>) => void;
  addCollapsedLogItem: (streamId: string, itemId: string) => void;
  removeCollapsedLogItem: (streamId: string, itemId: string) => void;
  toggleCollapsedLogItem: (streamId: string, itemId: string) => void;
  pruneCollapsedLogItemsForStream: (
    streamId: string,
    validIds: Iterable<string>,
  ) => void;
  setBridgeDefaults: (defaults: Partial<BridgePreferencesPayload["defaults"]>) => void;
  upsertBridgeSession: (
    streamId: string,
    session: Partial<BridgeStreamSession>,
  ) => void;
  clearBridgeSession: (streamId: string) => void;
  setBridgeSessionActive: (streamId: string, active: boolean) => void;
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

const DEFAULT_BRIDGE_DEFAULTS: BridgePreferencesPayload["defaults"] = {
  providerId: "gemini",
  quickPreset: "recommended",
};

function createDefaultBridgeContextRecipe(): BridgeContextRecipe {
  return {
    entrySelection: "all",
    includeCanvas: true,
    includeGlobalStream: true,
  };
}

function createDefaultBridgeSession(): BridgeStreamSession {
  return {
    providerId: DEFAULT_BRIDGE_DEFAULTS.providerId,
    lastMode: "BOTH",
    lastContextRecipe: createDefaultBridgeContextRecipe(),
    lastInstruction: "",
    sessionMemory: "",
    lastUsedAt: null,
    isExternalSessionActive: false,
    externalSessionLoadedAt: null,
  };
}

function normalizeSessionMemory(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
}

function normalizeBridgeSession(
  session: Partial<BridgeStreamSession> | undefined,
): BridgeStreamSession {
  const base = createDefaultBridgeSession();
  return {
    providerId: session?.providerId ?? base.providerId,
    lastMode: session?.lastMode ?? base.lastMode,
    lastContextRecipe: {
      ...base.lastContextRecipe,
      ...(session?.lastContextRecipe ?? {}),
    },
    lastInstruction: (session?.lastInstruction ?? base.lastInstruction).trim(),
    sessionMemory: normalizeSessionMemory(
      session?.sessionMemory ?? base.sessionMemory,
    ),
    lastUsedAt: session?.lastUsedAt ?? base.lastUsedAt,
    isExternalSessionActive:
      session?.isExternalSessionActive ?? base.isExternalSessionActive,
    externalSessionLoadedAt:
      session?.externalSessionLoadedAt ?? base.externalSessionLoadedAt,
  };
}

function buildSessionMemory(instruction: string, mode: BridgeInteractionMode) {
  const trimmed = instruction.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const prefix = `Recent ${mode.toLowerCase()} objective: `;
  return normalizeSessionMemory(`${prefix}${trimmed}`);
}

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
    | "logCollapsedItemIdsByStream"
    | "bridgeDefaults"
    | "bridgeSessionsByStream"
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
    log: {
      collapsedItemIdsByStream: Object.fromEntries(
        Object.entries(state.logCollapsedItemIdsByStream).map(
          ([streamId, ids]: [string, string[]]) => [streamId, toSortedUniqueIds(ids)],
        ),
      ),
    },
    bridge: {
      defaults: {
        providerId: state.bridgeDefaults.providerId,
        quickPreset: state.bridgeDefaults.quickPreset,
      },
      sessionsByStream: Object.fromEntries(
        Object.entries(state.bridgeSessionsByStream).map(([streamId, session]) => [
          streamId,
          normalizeBridgeSession(session),
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
        ([domainId, ids]: [string, string[]]) => [domainId, toSortedUniqueIds(ids)],
      ),
    ),
    logCollapsedItemIdsByStream: Object.fromEntries(
      Object.entries(payload.log?.collapsedItemIdsByStream ?? {}).map(
        ([streamId, ids]: [string, string[]]) => [streamId, toSortedUniqueIds(ids)],
      ),
    ),
    bridgeDefaults: {
      providerId:
        payload.bridge?.defaults?.providerId ?? current.bridgeDefaults.providerId,
      quickPreset:
        payload.bridge?.defaults?.quickPreset ?? current.bridgeDefaults.quickPreset,
    },
    bridgeSessionsByStream: Object.fromEntries(
      Object.entries(payload.bridge?.sessionsByStream ?? {}).map(
        ([streamId, session]) => [streamId, normalizeBridgeSession(session)],
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
      logCollapsedItemIdsByStream: {},
      bridgeDefaults: DEFAULT_BRIDGE_DEFAULTS,
      bridgeSessionsByStream: {},
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
      setCollapsedLogItemsForStream: (streamId, ids) => {
        set((state) => {
          const nextIds = toSortedUniqueIds(ids);
          const currentIds = state.logCollapsedItemIdsByStream[streamId] ?? [];
          if (JSON.stringify(currentIds) === JSON.stringify(nextIds)) {
            return state;
          }
          return touchLocalState({
            logCollapsedItemIdsByStream: {
              ...state.logCollapsedItemIdsByStream,
              [streamId]: nextIds,
            },
          });
        });
      },
      addCollapsedLogItem: (streamId, itemId) => {
        set((state) => {
          const currentIds = state.logCollapsedItemIdsByStream[streamId] ?? [];
          if (currentIds.includes(itemId)) return state;
          return touchLocalState({
            logCollapsedItemIdsByStream: {
              ...state.logCollapsedItemIdsByStream,
              [streamId]: toSortedUniqueIds([...currentIds, itemId]),
            },
          });
        });
      },
      removeCollapsedLogItem: (streamId, itemId) => {
        set((state) => {
          const currentIds = state.logCollapsedItemIdsByStream[streamId] ?? [];
          if (!currentIds.includes(itemId)) return state;
          return touchLocalState({
            logCollapsedItemIdsByStream: {
              ...state.logCollapsedItemIdsByStream,
              [streamId]: currentIds.filter((id) => id !== itemId),
            },
          });
        });
      },
      toggleCollapsedLogItem: (streamId, itemId) => {
        const state = get();
        if ((state.logCollapsedItemIdsByStream[streamId] ?? []).includes(itemId)) {
          get().removeCollapsedLogItem(streamId, itemId);
          return;
        }
        get().addCollapsedLogItem(streamId, itemId);
      },
      pruneCollapsedLogItemsForStream: (streamId, validIds) => {
        set((state) => {
          const currentIds = state.logCollapsedItemIdsByStream[streamId] ?? [];
          if (!currentIds.length) return state;

          const validIdSet = new Set(validIds);
          const nextIds = currentIds.filter((id) => validIdSet.has(id));
          if (nextIds.length === currentIds.length) return state;

          return touchLocalState({
            logCollapsedItemIdsByStream: {
              ...state.logCollapsedItemIdsByStream,
              [streamId]: nextIds,
            },
          });
        });
      },
      setBridgeDefaults: (defaults) => {
        set((state) => {
          const nextDefaults = {
            ...state.bridgeDefaults,
            ...defaults,
          };
          if (JSON.stringify(nextDefaults) === JSON.stringify(state.bridgeDefaults)) {
            return state;
          }
          return touchLocalState({ bridgeDefaults: nextDefaults });
        });
      },
      upsertBridgeSession: (streamId, session) => {
        set((state) => {
          const current = state.bridgeSessionsByStream[streamId];
          const merged = normalizeBridgeSession({
            ...current,
            ...session,
            lastContextRecipe: {
              ...(current?.lastContextRecipe ?? createDefaultBridgeContextRecipe()),
              ...(session.lastContextRecipe ?? {}),
            },
            sessionMemory:
              session.sessionMemory ??
              buildSessionMemory(
                session.lastInstruction ?? current?.lastInstruction ?? "",
                (session.lastMode ?? current?.lastMode ?? "BOTH") as BridgeInteractionMode,
              ),
          });
          if (JSON.stringify(current) === JSON.stringify(merged)) return state;
          return touchLocalState({
            bridgeSessionsByStream: {
              ...state.bridgeSessionsByStream,
              [streamId]: merged,
            },
          });
        });
      },
      clearBridgeSession: (streamId) => {
        set((state) => {
          if (!(streamId in state.bridgeSessionsByStream)) return state;
          const nextSessions = { ...state.bridgeSessionsByStream };
          delete nextSessions[streamId];
          return touchLocalState({ bridgeSessionsByStream: nextSessions });
        });
      },
      setBridgeSessionActive: (streamId, active) => {
        set((state) => {
          const current = state.bridgeSessionsByStream[streamId];
          if (!current && !active) return state;

          const nextSession = normalizeBridgeSession({
            ...current,
            isExternalSessionActive: active,
            externalSessionLoadedAt: active
              ? new Date().toISOString()
              : null,
          });

          if (JSON.stringify(current) === JSON.stringify(nextSession)) {
            return state;
          }

          return touchLocalState({
            bridgeSessionsByStream: {
              ...state.bridgeSessionsByStream,
              [streamId]: nextSession,
            },
          });
        });
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
        logCollapsedItemIdsByStream: state.logCollapsedItemIdsByStream,
        bridgeDefaults: state.bridgeDefaults,
        bridgeSessionsByStream: state.bridgeSessionsByStream,
        localUpdatedAt: state.localUpdatedAt,
        lastSyncedAt: state.lastSyncedAt,
        cloudHydratedUserId: state.cloudHydratedUserId,
        activeUserId: state.activeUserId,
      }),
    },
  ),
);
