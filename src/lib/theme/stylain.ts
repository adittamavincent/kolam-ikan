type Mode = "A" | "B";

const STORAGE_KEY = "stylain:mode";
const EVENT_WILL = "stylain_mode_will_change";
const EVENT_DID = "stylain_mode_changed";

type StylainWindow = Window & { __stylain_mode?: Mode };

function applyClass(mode: Mode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "B") {
    root.classList.add("stylain-ide");
    root.setAttribute("data-stylain-mode", "B");
  } else {
    root.classList.remove("stylain-ide");
    root.setAttribute("data-stylain-mode", "A");
  }
}

let CURRENT_MODE: Mode = "A";

// Initialize synchronously when possible to avoid flicker
export function initStylain() {
  try {
    const hasLocalStorage = typeof globalThis !== "undefined" && "localStorage" in globalThis;
    const hasWindow = typeof window !== "undefined";
    const stored = hasLocalStorage
      ? globalThis.localStorage.getItem(STORAGE_KEY)
      : null;
    const mode: Mode = stored && typeof stored === "string" && stored.toUpperCase() === "B" ? "B" : "A";
    CURRENT_MODE = mode;
    if (hasWindow) applyClass(mode);
    try {
      if (hasWindow) (window as StylainWindow).__stylain_mode = mode;
    } catch {}
  } catch {
  }
}

export function getStylainMode(): Mode {
  if (typeof window === "undefined") return CURRENT_MODE;
  return CURRENT_MODE;
}

export function setStylainMode(mode: Mode) {
  const hasLocalStorage = typeof globalThis !== "undefined" && "localStorage" in globalThis;
  const hasWindow = typeof window !== "undefined";
  try {
    if (mode === CURRENT_MODE) {
      if (hasLocalStorage) {
        globalThis.localStorage.setItem(STORAGE_KEY, mode);
      }
      if (hasWindow) applyClass(mode);
      return;
    }

    if (hasWindow) {
      window.dispatchEvent(new CustomEvent(EVENT_WILL, { detail: { mode } }));
    }
    if (hasLocalStorage) {
      globalThis.localStorage.setItem(STORAGE_KEY, mode);
    }
    CURRENT_MODE = mode;
    if (hasWindow) applyClass(mode);

    // Ensure all updates are completed before dispatching the final event
    if (hasWindow && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(EVENT_DID, { detail: { mode } }));
      });
    } else if (hasWindow) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent(EVENT_DID, { detail: { mode } }));
      }, 0);
    }
  } catch (error) {
    console.error("Failed to set Stylain mode:", error);
    try {
      if (hasLocalStorage) globalThis.localStorage.setItem(STORAGE_KEY, mode);
      CURRENT_MODE = mode;
      if (hasWindow) applyClass(mode);
    } catch (nestedError) {
      console.error("Nested error while setting Stylain mode:", nestedError);
    }
  }
}

export function onStylainWillChange(fn: (e: CustomEvent<{ mode: Mode }>) => void) {
  window.addEventListener(EVENT_WILL, fn as EventListener);
  return () => window.removeEventListener(EVENT_WILL, fn as EventListener);
}

export function onStylainChanged(fn: (e: CustomEvent<{ mode: Mode }>) => void) {
  window.addEventListener(EVENT_DID, fn as EventListener);
  return () => window.removeEventListener(EVENT_DID, fn as EventListener);
}

// Do not auto-initialize during module evaluation to avoid
// potential SSR hydration mismatches. Call `initStylain()` from a
// client-side entry point (e.g. a top-level client provider) so the
// DOM attributes are only mutated after hydration.

export type { Mode };
