"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export const useSidebar = create<SidebarState>()(
  persist(
    (set) => ({
      visible: false,
      width: 256,
      isResizing: false,

      show: () => set({ visible: true }),
      hide: () => set({ visible: false }),
      setVisible: (visible) => set({ visible }),
      setWidth: (width) => set({ width }),
      setIsResizing: (isResizing) => set({ isResizing }),
    }),
    {
      name: "sidebar-storage",
      partialize: (state) => ({ width: state.width, visible: state.visible }),
      skipHydration: true,
    },
  ),
);
