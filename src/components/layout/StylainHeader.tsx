"use client";

import { useEffect, useState, useRef } from "react";
import {
  getStylainMode,
  prepareStylainModeChange,
  setStylainMode,
  type Mode,
} from "@/lib/theme/stylain";

export default function StylainHeader() {
  // Use a deterministic default to avoid SSR hydration mismatches.
  const [mode, setMode] = useState<Mode>("A");
  const [transitioning, setTransitioning] = useState(false);
  const pendingRef = useRef<Mode | null>(null);

  useEffect(() => {
    // Read actual mode on client after mount
    try {
      setMode(getStylainMode());
    } catch {}
    // listen for external changes (e.g., another tab)
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode: Mode }>)?.detail;
      if (detail?.mode) setMode(detail.mode);
    };
    window.addEventListener("storage", handler);
    window.addEventListener("stylain_mode_changed", handler as EventListener);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("stylain_mode_changed", handler as EventListener);
    };
  }, []);

  const toggle = () => {
    const next: Mode = mode === "A" ? "B" : "A";
    // debounce quick toggles: if a transition is happening, queue the latest
    if (transitioning) {
      pendingRef.current = next;
      return;
    }
    setTransitioning(true);
    try {
      setStylainMode(next);
      setMode(next);
      // debug trace
      try {
        console.debug("Stylain toggled", { next, classPresent: document.documentElement.classList.contains("stylain-ide") });
      } catch {}
    } catch (err) {
      console.error("Theme toggle failed", err);
      // visual error handling: brief shake / aria-live
    } finally {
      window.requestAnimationFrame(() => {
        setTransitioning(false);
        if (pendingRef.current) {
          const queued = pendingRef.current;
          pendingRef.current = null;
          setStylainMode(queued);
          setMode(queued);
        }
      });
    }
  };

  return (
    <div className="flex items-center">
      <button
        aria-label={`Switch to ${mode === "A" ? "Raw Markdown (B)" : "Rich Block (A)"} mode`}
        title={mode === "A" ? "Switch to Raw Markdown (B)" : "Switch to Rich Block (A)"}
        onMouseDown={(e) => {
          prepareStylainModeChange(mode === "A" ? "B" : "A");
          // Keep focus in the active editor while toggling modes via mouse.
          e.preventDefault();
        }}
        onClick={toggle}
        className={`inline-flex items-center gap-2 rounded-sm border border-border-default/40 bg-surface-subtle px-2 py-1 text-[11px] font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-action-primary-bg ${transitioning ? "opacity-70" : "hover:bg-surface-default"}`}
      >
        <span className="sr-only">Writing mode toggle</span>
        <span className={`rounded-sm px-1.5 py-0.5 font-mono ${mode === "A" ? "bg-action-primary-bg/15 text-action-primary-bg" : "text-text-muted"}`}>
          A
        </span>
        <span className="text-text-muted">/</span>
        <span className={`rounded-sm px-1.5 py-0.5 font-mono ${mode === "B" ? "bg-action-primary-bg/15 text-action-primary-bg" : "text-text-muted"}`}>
          B
        </span>
        <span className="font-mono text-[10px] text-text-muted">
          {mode === "A" ? "rich" : "raw md"}
        </span>
      </button>
    </div>
  );
}
