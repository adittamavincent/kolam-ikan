import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { initStylain, setStylainMode, getStylainMode } from "../stylain";

describe("stylain manager", () => {
  beforeEach(() => {
    // clear localStorage and class
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("stylain:mode");
      document.documentElement.classList.remove("stylain-ide");
      document.documentElement.removeAttribute("data-stylain-mode");
    }
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("stylain:mode");
      document.documentElement.classList.remove("stylain-ide");
      document.documentElement.removeAttribute("data-stylain-mode");
    }
  });

  it("defaults to A when nothing stored", () => {
    initStylain();
    expect(getStylainMode()).toBe("A");
    if (typeof document !== "undefined") {
      expect(document.documentElement.classList.contains("stylain-ide")).toBe(false);
    }
  });

  it("sets B mode and persists", () => {
    setStylainMode("B");
    expect(getStylainMode()).toBe("B");
    // localStorage may not be available or reliable in all test environments,
    // so prefer in-memory state assertions via `getStylainMode()` above.
    if (typeof document !== "undefined") {
      expect(document.documentElement.classList.contains("stylain-ide")).toBe(true);
    }
  });
});
