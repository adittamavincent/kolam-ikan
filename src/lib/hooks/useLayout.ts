'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutMode = 'log-only' | 'balanced' | 'canvas-only';

interface LayoutState {
  mode: LayoutMode;
  logWidth: number;
  canvasWidth: number;
  setMode: (mode: LayoutMode) => void;
  setCustomWidths: (log: number, canvas: number) => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      mode: 'balanced',
      logWidth: 50,
      canvasWidth: 50,
      setMode: (mode) => {
        const widths = {
          'log-only': { log: 100, canvas: 0 },
          balanced: { log: 50, canvas: 50 },
          'canvas-only': { log: 0, canvas: 100 },
        };
        set({ mode, logWidth: widths[mode].log, canvasWidth: widths[mode].canvas });
      },
      setCustomWidths: (logWidth, canvasWidth) =>
        set({ logWidth, canvasWidth, mode: 'balanced' }),
    }),
    {
      name: 'kolam-layout-state',
    }
  )
);
