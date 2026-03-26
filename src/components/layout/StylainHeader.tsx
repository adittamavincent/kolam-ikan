"use client";

import { useEffect, useState, useRef } from "react";
import { Blocks, SquareCode } from "lucide-react";
import {
  getStylainMode,
  prepareStylainModeChange,
  setStylainMode,
  type Mode,
} from "@/lib/theme/stylain";

type StylainHeaderProps = {
  compact?: boolean;
};

export default function StylainHeader({
  compact = false,
}: StylainHeaderProps) {
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

  const nextMode = mode === "A" ? "B" : "A";
  const title =
    mode === "A" ? "Switch to Raw Markdown (B)" : "Switch to Rich Block (A)";
  const CurrentIcon = mode === "A" ? Blocks : SquareCode;

  if (compact) {
    return (
      <button
        aria-label={title}
        title={title}
        onMouseDown={(e) => {
          prepareStylainModeChange(nextMode);
          // Keep focus in the active editor while toggling modes via mouse.
          e.preventDefault();
        }}
        onClick={toggle}
        className={`relative inline-flex h-8 w-8 items-center justify-center border border-border-default/60 bg-surface-subtle text-text-muted shadow-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-action-primary-bg/70 ${
          mode === "A"
            ? "hover:border-action-primary-bg/30 hover:bg-action-primary-bg/10 hover:text-action-primary-bg"
            : "hover:border-border-default hover:bg-surface-default hover:text-text-default"
        } ${transitioning ? "opacity-70" : ""}`}
      >
        <span className="sr-only">Writing mode toggle</span>
        <CurrentIcon className="h-3.5 w-3.5" />
        <span
          className={`absolute -bottom-1 -right-1 inline-flex min-w-4 items-center justify-center border border-surface-default bg-surface-elevated px-1 text-[8px] font-black leading-none ${
            mode === "A" ? "text-action-primary-bg" : "text-text-muted"
          }`}
        >
          {mode}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center">
      <button
        aria-label={title}
        title={title}
        onMouseDown={(e) => {
          prepareStylainModeChange(nextMode);
          // Keep focus in the active editor while toggling modes via mouse.
          e.preventDefault();
        }}
        onClick={toggle}
        className={`inline-flex items-center gap-2 border border-border-default/40 bg-surface-subtle px-2 py-1 text-[11px] font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-action-primary-bg ${transitioning ? "opacity-70" : "hover:bg-surface-default"}`}
      >
        <span className="sr-only">Writing mode toggle</span>
        <span className={`px-1.5 py-0.5 font-mono ${mode === "A" ? "bg-action-primary-bg/15 text-action-primary-bg" : "text-text-muted"}`}>
          A
        </span>
        <span className="text-text-muted">/</span>
        <span className={`px-1.5 py-0.5 font-mono ${mode === "B" ? "bg-action-primary-bg/15 text-action-primary-bg" : "text-text-muted"}`}>
          B
        </span>
        <span className="font-mono text-[10px] text-text-muted">
          {mode === "A" ? "rich" : "raw md"}
        </span>
      </button>
    </div>
  );
}
