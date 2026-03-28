"use client";

import { useShallow } from "zustand/react/shallow";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

interface SidebarState {
  /** Whether the sidebar (Navigator) is visible */
  visible: boolean;
  /** Width of the sidebar in pixels */
  width: number;
  /** Whether the sidebar is being resized */
  isResizing: boolean;
  /** Show the sidebar */
  show: () => void;
  /** Hide the sidebar */
  hide: () => void;
  /** Directly set visibility */
  setVisible: (visible: boolean) => void;
  /** Set the sidebar width */
  setWidth: (width: number) => void;
  /** Set the resizing state */
  setIsResizing: (isResizing: boolean) => void;
}

export function useSidebar(): SidebarState {
  return useUiPreferencesStore(
    useShallow((state) => ({
      visible: state.sidebarVisible,
      width: state.sidebarWidths[state.deviceClass],
      isResizing: state.isSidebarResizing,
      show: state.showSidebar,
      hide: state.hideSidebar,
      setVisible: state.setSidebarVisible,
      setWidth: state.setSidebarWidth,
      setIsResizing: state.setSidebarResizing,
    })),
  );
}
