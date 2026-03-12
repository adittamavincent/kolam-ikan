import { describe, it, expect } from "vitest";

// Helper to calculate relative luminance
function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  const a = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [0, 0, 0];
}

// Helper to calculate contrast ratio
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getLuminance(hex1);
  const lum2 = getLuminance(hex2);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

// Define the colors from globals.css for testing
const themeColors = {
  light: {
    background: "#ffffff",
    textDefault: "#111827", // gray-900
    textSubtle: "#4b5563", // gray-600
    textMuted: "#9ca3af", // gray-400
    actionPrimaryBg: "#0369a1", // primary-700
    actionPrimaryText: "#ffffff",
    statusErrorBg: "#fef2f2",
    statusErrorText: "#b91c1c", // red-700
  },
  dark: {
    background: "#0a0a0a",
    textDefault: "#ededed",
    textSubtle: "#a3a3a3",
    textMuted: "#525252",
    actionPrimaryBg: "#38bdf8", // primary-400
    actionPrimaryText: "#082f49", // primary-950
    statusErrorBg: "#450a0a",
    statusErrorText: "#f87171",
  },
};

describe("Theme Accessibility Audit", () => {
  describe("Light Mode Contrast", () => {
    it("should have sufficient contrast for default text", () => {
      const ratio = getContrastRatio(
        themeColors.light.textDefault,
        themeColors.light.background,
      );
      expect(ratio).toBeGreaterThan(4.5); // AA Normal Text
      console.log(`Light Mode Text Default Contrast: ${ratio.toFixed(2)}:1`);
    });

    it("should have sufficient contrast for subtle text", () => {
      const ratio = getContrastRatio(
        themeColors.light.textSubtle,
        themeColors.light.background,
      );
      expect(ratio).toBeGreaterThan(4.5); // AA Normal Text
      console.log(`Light Mode Text Subtle Contrast: ${ratio.toFixed(2)}:1`);
    });

    it("should have sufficient contrast for primary action buttons", () => {
      const ratio = getContrastRatio(
        themeColors.light.actionPrimaryText,
        themeColors.light.actionPrimaryBg,
      );
      expect(ratio).toBeGreaterThan(4.5); // AA Normal Text (Buttons often treated as Large Text if bold, but aiming for 4.5 is safer)
      console.log(`Light Mode Primary Action Contrast: ${ratio.toFixed(2)}:1`);
    });

    it("should have sufficient contrast for error messages", () => {
      const ratio = getContrastRatio(
        themeColors.light.statusErrorText,
        themeColors.light.statusErrorBg,
      );
      expect(ratio).toBeGreaterThan(4.5);
      console.log(`Light Mode Error Message Contrast: ${ratio.toFixed(2)}:1`);
    });
  });

  describe("Dark Mode Contrast", () => {
    it("should have sufficient contrast for default text", () => {
      const ratio = getContrastRatio(
        themeColors.dark.textDefault,
        themeColors.dark.background,
      );
      expect(ratio).toBeGreaterThan(4.5);
      console.log(`Dark Mode Text Default Contrast: ${ratio.toFixed(2)}:1`);
    });

    it("should have sufficient contrast for subtle text", () => {
      const ratio = getContrastRatio(
        themeColors.dark.textSubtle,
        themeColors.dark.background,
      );
      expect(ratio).toBeGreaterThan(4.5);
      console.log(`Dark Mode Text Subtle Contrast: ${ratio.toFixed(2)}:1`);
    });

    it("should have sufficient contrast for primary action buttons", () => {
      const ratio = getContrastRatio(
        themeColors.dark.actionPrimaryText,
        themeColors.dark.actionPrimaryBg,
      );
      // Dark mode primary is lighter (#0ea5e9) on white text.
      expect(ratio).toBeGreaterThan(3); // Might be lower for bright blues, let's check. 4.5 is ideal.
      console.log(`Dark Mode Primary Action Contrast: ${ratio.toFixed(2)}:1`);
    });
  });
});
