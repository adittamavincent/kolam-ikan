import { create } from "zustand";

interface CanvasScrollState {
  targetBlockId: string | null;
  setTargetBlockId: (id: string | null) => void;
}

export const useCanvasScroll = create<CanvasScrollState>((set) => ({
  targetBlockId: null,
  setTargetBlockId: (id) => set({ targetBlockId: id }),
}));
