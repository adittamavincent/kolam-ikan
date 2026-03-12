'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutMode = 'log-only' | 'balanced' | 'canvas-only';

interface LayoutState {
  mode: LayoutMode;
  logWidth: number;
  canvasWidth: number;
  previousWidths: { log: number; canvas: number };
  setMode: (mode: LayoutMode) => void;
  setCustomWidths: (log: number, canvas: number) => void;
  toggleLogCollapse: () => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      mode: 'balanced',
      logWidth: 50,
      canvasWidth: 50,
      previousWidths: { log: 50, canvas: 50 },
      setMode: (mode) => {
        const widths = {
          'log-only': { log: 100, canvas: 0 },
          balanced: { log: 50, canvas: 50 },
          'canvas-only': { log: 0, canvas: 100 },
        };
        set({
          mode,
          logWidth: widths[mode].log,
          canvasWidth: widths[mode].canvas,
          previousWidths: widths[mode],
        });
      },
      setCustomWidths: (logWidth, canvasWidth) =>
        set({ logWidth, canvasWidth, mode: 'balanced', previousWidths: { log: logWidth, canvas: canvasWidth } }),
      toggleLogCollapse: () =>
        set((state) => {
          if (state.logWidth > 0) {
            return {
              logWidth: 0,
              canvasWidth: 100,
              mode: 'canvas-only',
              previousWidths: { log: state.logWidth, canvas: state.canvasWidth },
            };
          }

          const next = state.previousWidths ?? { log: 50, canvas: 50 };
          return {
            logWidth: next.log,
            canvasWidth: next.canvas,
            mode: next.log === 0 ? 'canvas-only' : next.canvas === 0 ? 'log-only' : 'balanced',
          };
        }),
    }),
    {
      name: 'kolam-layout-state',
      skipHydration: true,
    }
  )
);
