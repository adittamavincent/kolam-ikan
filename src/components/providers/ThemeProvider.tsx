/**
 * Enhanced Theme Context and Provider
 * Provides theme switching capability with localStorage persistence
 */

import React, { createContext, useContext, useLayoutEffect, useState } from "react";

type ThemeMode = "dark" | "light";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

// Apply theme to document
const applyTheme = (themeMode: ThemeMode) => {
  const root = document.documentElement;
  if (themeMode === "light") {
    root.style.colorScheme = "light";
    root.classList.remove("dark");
    root.classList.add("light");
  } else {
    root.style.colorScheme = "dark";
    root.classList.remove("light");
    root.classList.add("dark");
  }
};

/**
 * ThemeProvider - Manages theme state with persistence
 * Should wrap the main application layout
 */
export function ThemeProvider({
  children,
  defaultMode = "dark",
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    // Initialize from localStorage or system preference
    if (typeof window === "undefined") return defaultMode;
    
    const stored = localStorage.getItem("kolam-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return systemDark ? "dark" : "light";
  });

  // Apply theme when mode changes
  useLayoutEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem("kolam-theme", newMode);
  };

  const toggleTheme = () => {
    const newMode = mode === "dark" ? "light" : "dark";
    setMode(newMode);
  };

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * useThemeContext - Access theme state and controls
 * Requires ThemeProvider to be in component tree
 */
export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return context;
}
