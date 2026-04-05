/**
 * Centralized color system for Kolam Ikan
 * Single source of truth for all application colors
 */

/* ============================================================================ */
/* PRIMITIVES - Brand & Base Colors                                           */
/* ============================================================================ */

export const PRIMITIVES = {
  // Primary Brand Colors (blue scale)
  primary: {
    50: "#eef3ff",
    100: "#dae6ff",
    200: "#b7cfff",
    300: "#95b8ff",
    400: "#7fa8ff",
    500: "#568af2",
    600: "#4d78cc",
    700: "#4269b9",
    800: "#375698",
    900: "#2e477b",
    950: "#243963",
  },

  // Domain-specific colors
  domain: {
    programming: "#75beff", // Accent blue
    internship: "#c586c0", // Accent violet
    gym: "#f48771", // Accent red
    scholarship: "#89d185", // Accent green
    hima: "#d7ba7d", // Accent amber
  },
} as const;

/* ============================================================================ */
/* DARK MODE - Kolam Dark (Default)                                            */
/* ============================================================================ */

export const DARK_MODE = {
  // Base
  background: "#181818",
  foreground: "#cccccc",

  // Surfaces
  surface: {
    default: "#181818",
    subtle: "#1f1f1f",
    elevated: "#252526",
    hover: "#2a2d2e",
    dark: "#111111",
    overlay: "#202020",
  },

  // Text
  text: {
    default: "#cccccc",
    subtle: "#c5c5c5",
    muted: "#8b949e",
    inverse: "#ffffff",
  },

  // Borders
  border: {
    default: "#2b2b2b",
    subtle: "#232323",
    strong: "#3c3c3c",
  },

  // Actions
  action: {
    primary: {
      bg: "#0e639c",
      hover: "#1177bb",
      text: "#ffffff",
      disabled: "#245b7a",
    },
    secondary: {
      bg: "#252526",
      hover: "#2a2d2e",
      text: "#cccccc",
      border: "#3c3c3c",
    },
  },

  // Status / Feedback
  status: {
    error: {
      bg: "#5a1d1d",
      border: "#7a2d2d",
      text: "#f48771",
    },
    success: {
      bg: "#19362b",
      text: "#89d185",
    },
  },

  // Git / Diff
  diff: {
    add: {
      bg: "#1b3a2f",
      subtle: "#224536",
      text: "#89d185",
      accent: "#73c991",
    },
    del: {
      bg: "#4b1818",
      subtle: "#5e2323",
      text: "#f48771",
      accent: "#f14c4c",
    },
  },

  // Editor-specific
  editor: {
    background: "#1e1e1e",
    text: "#d4d4d4",
  },
} as const;

/* ============================================================================ */
/* LIGHT MODE - Coming Soon                                                    */
/* ============================================================================ */

export const LIGHT_MODE = {
  // Base
  background: "#ffffff",
  foreground: "#2c3e50",

  // Surfaces
  surface: {
    default: "#ffffff",
    subtle: "#f8f9fb",
    elevated: "#f0f2f7",
    hover: "#e8ecf1",
    dark: "#f0f2f7",
    overlay: "#ffffff",
  },

  // Text
  text: {
    default: "#2c3e50",
    subtle: "#5a6977",
    muted: "#8b95a5",
    inverse: "#ffffff",
  },

  // Borders
  border: {
    default: "#d4dce4",
    subtle: "#e8ecf1",
    strong: "#c0c8d4",
  },

  // Actions
  action: {
    primary: {
      bg: "#568af2",
      hover: "#4d78cc",
      text: "#ffffff",
      disabled: "#4269b9",
    },
    secondary: {
      bg: "#e8ecf1",
      hover: "#d4dce4",
      text: "#2c3e50",
      border: "#c0c8d4",
    },
  },

  // Status / Feedback
  status: {
    error: {
      bg: "#fce8eb",
      border: "#f5c5d0",
      text: "#c41e3a",
    },
    success: {
      bg: "#e8f5e9",
      text: "#2e7d32",
    },
  },

  // Git / Diff
  diff: {
    add: {
      bg: "#e8f5e9",
      subtle: "#f1f8f6",
      text: "#2e7d32",
      accent: "#4caf50",
    },
    del: {
      bg: "#ffebee",
      subtle: "#fff5f7",
      text: "#c41e3a",
      accent: "#ef5350",
    },
  },

  // Editor-specific
  editor: {
    background: "#f8f9fb",
    text: "#2c3e50",
  },
} as const;

/* ============================================================================ */
/* THEME TYPE & HELPER FUNCTIONS                                               */
/* ============================================================================ */

export type ThemeMode = "dark" | "light";

export const THEME_MODES = {
  dark: DARK_MODE,
  light: LIGHT_MODE,
} as const;

/**
 * Get current theme based on system preference or stored preference
 */
export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Get all colors for a specific theme
 */
export function getThemeColors(mode: ThemeMode = "dark") {
  return THEME_MODES[mode];
}

/* ============================================================================ */
/* COLOR UTILITIES                                                              */
/* ============================================================================ */

/**
 * Normalize hex color to #RRGGBB format
 */
export function normalizeHexColor(color?: string | null): string | undefined {
  if (!color) return undefined;

  const normalized = color.trim().replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((chunk) => `${chunk}${chunk}`)
          .join("")
      : normalized;

  if (!/^[\da-fA-F]{6}$/.test(expanded)) {
    return undefined;
  }

  return `#${expanded.toLowerCase()}`;
}

/**
 * Blend two hex colors with alpha blending
 * @param foreground - Foreground color (hex)
 * @param background - Background color (hex)
 * @param alpha - Blend factor (0-1)
 */
export function blendHexColors(
  foreground?: string | null,
  background?: string | null | typeof DARK_MODE.surface.default,
  alpha = 1,
): string | undefined {
  const fg = normalizeHexColor(foreground);
  const bg = normalizeHexColor(background ?? DARK_MODE.surface.default);

  if (!fg || !bg) return fg ?? bg;

  const clampAlpha = Math.max(0, Math.min(1, alpha));
  const fgChannels = fg
    .slice(1)
    .match(/../g)
    ?.map((channel) => Number.parseInt(channel, 16));
  const bgChannels = bg
    .slice(1)
    .match(/../g)
    ?.map((channel) => Number.parseInt(channel, 16));

  if (!fgChannels || !bgChannels) return fg;

  const blended = fgChannels.map((value, index) =>
    Math.round(value * clampAlpha + bgChannels[index] * (1 - clampAlpha)),
  );

  return `#${blended.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Convert hex color with optional opacity suffix
 * @param color - Hex color or color with opacity suffix (e.g., #abc20 = 12.5% opacity)
 */
export function parseHexColorWithOpacity(
  color?: string | null,
): {
  hex?: string;
  opacity?: number;
} | null {
  if (!color) return null;

  const clean = color.replace("#", "");

  // Check if it has opacity suffix (e.g., "abc20" where "20" is hex opacity)
  if (clean.length === 8) {
    const hex = `#${clean.slice(0, 6)}`;
    const opacityHex = clean.slice(6, 8);
    const opacity = Number.parseInt(opacityHex, 16) / 255;
    return { hex: normalizeHexColor(hex), opacity };
  }

  // Standard 6-char hex
  if (clean.length === 6) {
    return { hex: normalizeHexColor(`#${clean}`), opacity: 1 };
  }

  return null;
}

/**
 * Apply opacity to a hex color using hex suffix notation
 * @param color - Hex color
 * @param opacity - Opacity (0-1)
 */
export function applyHexOpacity(color: string, opacity: number): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) return color;

  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const opacityByte = Math.round(clampedOpacity * 255);
  const opacityHex = opacityByte.toString(16).padStart(2, "0");

  return `${normalized}${opacityHex}`;
}

/* ============================================================================ */
/* PRESET COLORS FOR UI SELECTORS                                              */
/* ============================================================================ */

/**
 * Preset persona colors for color picker
 * Uses semantic theme colors + Tailwind palette
 */
export const PERSONA_PRESET_COLORS = [
  PRIMITIVES.domain.programming,
  PRIMITIVES.domain.internship,
  PRIMITIVES.domain.gym,
  PRIMITIVES.domain.scholarship,
  PRIMITIVES.domain.hima,
  "#0ea5e9", // Sky
  "#64748b", // Slate
  "#8b5cf6", // Violet
] as const;

/**
 * Get person preset icon names for icon picker
 */
export const PERSONA_PRESET_ICONS = [
  "user",
  "brain",
  "cloud-rain",
  "heart",
  "coffee",
  "code",
  "zap",
  "feather",
  "target",
  "shield",
  "star",
  "smile",
] as const;

/**
 * Branch colors for commit graph visualization
 */
export const BRANCH_COLORS = [
  PRIMITIVES.primary[500], // #568af2 - Primary blue
  "#26b88f", // Teal
  "#f59e0b", // Amber
  "#db7093", // Pale Violet Red
  "#8b7cf7", // Violet
  "#06b6d4", // Cyan
  "#84cc16", // Lime
  "#ef5c5c", // Red
] as const;

/**
 * WhatsApp import persona colors palette
 */
export const WHATSAPP_PERSONA_COLORS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#f43f5e", // Rose
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#0ea5e9", // Sky
  "#14b8a6", // Teal
  "#a855f7", // Purple
] as const;

/**
 * Default snapshot persona color
 */
export const DEFAULT_SNAPSHOT_PERSONA_COLOR = "#9CA3AF"; // Gray

/**
 * Default response color fallback
 */
export const DEFAULT_RESPONSE_COLOR = "#7c3aed"; // Violet
