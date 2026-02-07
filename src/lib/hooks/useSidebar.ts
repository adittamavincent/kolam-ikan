'use client';

import { create } from 'zustand';

interface SidebarState {
  /** Whether the sidebar (Navigator) is visible */
  visible: boolean;
  /** Whether the sidebar is mid-transition (used to prevent flashing) */
  animating: boolean;
  /** Show the sidebar with animation */
  show: () => void;
  /** Hide the sidebar with animation */
  hide: () => void;
  /** Directly set visibility without animation (for initial route-based state) */
  setVisible: (visible: boolean) => void;
}

export const useSidebar = create<SidebarState>()((set) => ({
  visible: false,
  animating: false,

  show: () => {
    set({ visible: true, animating: true });
    // Clear animating flag after the CSS transition completes (250ms)
    setTimeout(() => set({ animating: false }), 260);
  },

  hide: () => {
    set({ animating: true });
    // Keep visible during the out-animation, then hide
    setTimeout(() => set({ visible: false, animating: false }), 260);
  },

  setVisible: (visible) => set({ visible, animating: false }),
}));
