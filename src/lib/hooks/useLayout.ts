"use client";

import { useShallow } from "zustand/react/shallow";
import {
  useUiPreferencesStore,
  type LayoutMode,
} from "@/lib/hooks/useUiPreferencesStore";

interface LayoutState {
  mode: LayoutMode;
  logWidth: number;
  canvasWidth: number;
  previousWidths: { log: number; canvas: number };
  setMode: (mode: LayoutMode) => void;
  setCustomWidths: (log: number, canvas: number) => void;
  toggleLogCollapse: () => void;
}

export function useLayout(): LayoutState {
  return useUiPreferencesStore(
    useShallow((state) => {
      const widths = state.layoutWidthsByDevice[state.deviceClass];
      return {
        mode: state.layoutMode,
        logWidth: widths.log,
        canvasWidth: widths.canvas,
        previousWidths: widths.previous,
        setMode: state.setLayoutMode,
        setCustomWidths: state.setCustomLayoutWidths,
        toggleLogCollapse: state.toggleLogCollapse,
      };
    }),
  );
}
