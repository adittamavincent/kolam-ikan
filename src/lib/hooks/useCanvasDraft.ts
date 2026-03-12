import { create } from "zustand";

interface CanvasDraftState {
  dirtyStreams: Set<string>;
  markDirty: (streamId: string) => void;
  markClean: (streamId: string) => void;
  isDirty: (streamId: string) => boolean;
}

export const useCanvasDraft = create<CanvasDraftState>((set, get) => ({
  dirtyStreams: new Set<string>(),
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
}));
