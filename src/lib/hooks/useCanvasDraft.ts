import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PartialBlock } from "@/lib/types/editor";
import { areCanvasContentsEquivalent } from "@/lib/utils/canvasContent";

interface CanvasDraftState {
  dirtyStreams: Set<string>;
  liveContentByStream: Record<string, PartialBlock[] | null>;
  starterBaselineByStream: Record<
    string,
    { canvasId: string | null; content: PartialBlock[] | null }
  >;
  dbSyncStatusByStream: Record<string, "idle" | "syncing" | "synced" | "error">;
  localSaveStatusByStream: Record<string, "idle" | "saving" | "saved" | "error">;
  markDirty: (streamId: string) => void;
  markClean: (streamId: string) => void;
  isDirty: (streamId: string) => boolean;
  setLiveContent: (streamId: string, content: PartialBlock[] | null) => void;
  clearLiveContent: (streamId: string) => void;
  setStarterBaseline: (
    streamId: string,
    canvasId: string | null,
    content: PartialBlock[] | null,
  ) => void;
  setSyncStatus: (
    streamId: string,
    status: "idle" | "syncing" | "synced" | "error",
  ) => void;
  setLocalStatus: (
    streamId: string,
    status: "idle" | "saving" | "saved" | "error",
  ) => void;
}

interface PersistedCanvasState {
  liveContentByStream: Record<string, PartialBlock[] | null>;
}

export const useCanvasDraft = create<CanvasDraftState>()(
  persist(
    (set, get) => ({
      dirtyStreams: new Set<string>(),
      liveContentByStream: {},
      starterBaselineByStream: {},
      dbSyncStatusByStream: {},
      localSaveStatusByStream: {},
      markDirty: (streamId: string) => {
        set((state) => {
          if (state.dirtyStreams.has(streamId)) return state;
          const next = new Set(state.dirtyStreams);
          next.add(streamId);
          return { dirtyStreams: next };
        });
      },
      markClean: (streamId: string) => {
        set((state) => {
          if (!state.dirtyStreams.has(streamId)) return state;
          const next = new Set(state.dirtyStreams);
          next.delete(streamId);
          return { dirtyStreams: next };
        });
      },
      isDirty: (streamId: string) => get().dirtyStreams.has(streamId),
      setLiveContent: (streamId: string, content: PartialBlock[] | null) => {
        set((state) => {
          const localSaveStatusByStream = { ...state.localSaveStatusByStream };
          if (content) {
            localSaveStatusByStream[streamId] = "saved";
          } else {
            delete localSaveStatusByStream[streamId];
          }

          return {
            liveContentByStream: {
              ...state.liveContentByStream,
              [streamId]: content,
            },
            localSaveStatusByStream
          };
        });
      },
      clearLiveContent: (streamId: string) => {
        set((state) => {
          const hasLiveContent = streamId in state.liveContentByStream;
          const hasDirty = state.dirtyStreams.has(streamId);
          const hasBaseline = streamId in state.starterBaselineByStream;
          if (!hasLiveContent && !hasDirty && !hasBaseline) return state;

          const next = { ...state.liveContentByStream };
          delete next[streamId];

          const nextLocal = { ...state.localSaveStatusByStream };
          delete nextLocal[streamId];

          const nextDb = { ...state.dbSyncStatusByStream };
          delete nextDb[streamId];

          const nextDirty = new Set(state.dirtyStreams);
          nextDirty.delete(streamId);

          const nextBaseline = { ...state.starterBaselineByStream };
          delete nextBaseline[streamId];

          return {
            dirtyStreams: nextDirty,
            liveContentByStream: next,
            starterBaselineByStream: nextBaseline,
            localSaveStatusByStream: nextLocal,
            dbSyncStatusByStream: nextDb,
          };
        });
      },
      setStarterBaseline: (
        streamId: string,
        canvasId: string | null,
        content: PartialBlock[] | null,
      ) => {
        set((state) => {
          const current = state.starterBaselineByStream[streamId];
          if (
            current?.canvasId === canvasId &&
            areCanvasContentsEquivalent(current.content, content)
          ) {
            return state;
          }

          const starterBaselineByStream = {
            ...state.starterBaselineByStream,
          };

          if (!canvasId) {
            delete starterBaselineByStream[streamId];
          } else {
            starterBaselineByStream[streamId] = {
              canvasId,
              content,
            };
          }

          return {
            starterBaselineByStream,
          };
        });
      },
      setSyncStatus: (streamId: string, status: "idle" | "syncing" | "synced" | "error") => {
        set((state) => {
          if (state.dbSyncStatusByStream[streamId] === status) return state;
          return {
            dbSyncStatusByStream: {
              ...state.dbSyncStatusByStream,
              [streamId]: status,
            },
          };
        });
      },
      setLocalStatus: (streamId: string, status: "idle" | "saving" | "saved" | "error") => {
        set((state) => {
          if (state.localSaveStatusByStream[streamId] === status) return state;
          return {
            localSaveStatusByStream: {
              ...state.localSaveStatusByStream,
              [streamId]: status,
            },
          };
        });
      },
    }),
    {
      name: "kolam-canvas-drafts",
      partialize: (state) => ({
        liveContentByStream: state.liveContentByStream,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedCanvasState;
        return {
          ...currentState,
          ...persisted,
        };
      }
    }
  )
);
