/**
 * Shared light-only palette for non-CSS color logic.
 * Runtime UI colors should come from `src/app/globals.css` tokens.
 */

export const SHARED_PALETTE = {
  neutral: {
    0: "#ffffff",
    50: "#f6f8fb",
    100: "#eef2f6",
    200: "#dbe2ea",
    300: "#c4ced9",
    500: "#7b8693",
    700: "#526171",
    900: "#243242",
  },
  primary: {
    100: "#dbe7ff",
    200: "#b7cfff",
    400: "#7fa8ff",
    500: "#568af2",
    700: "#375698",
    800: "#2e477b",
    900: "#243963",
    950: "#1b2c52",
  },
  info: {
    bg: "#dcecf9",
    border: "#aac7e6",
    text: "#1f5e90",
  },
  success: {
    bg: "#dceddf",
    border: "#b7d1bc",
    text: "#2f6a3d",
  },
  warning: {
    bg: "#f7e9cc",
    border: "#e2c88d",
    text: "#8a5a00",
  },
  error: {
    bg: "#f5d8de",
    border: "#d8a5b1",
    text: "#8f2536",
  },
  accent: {
    teal: "#1d7d73",
    violet: "#6a56c9",
    coral: "#bf6a5a",
    lime: "#6f8c2d",
    slate: "#5f6d7b",
  },
} as const;

export const LIGHT_SURFACE_BASES = {
  default: SHARED_PALETTE.neutral[0],
  subtle: SHARED_PALETTE.neutral[50],
  elevated: SHARED_PALETTE.neutral[100],
} as const;

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
 * Blend two colors into a fully opaque hex result.
 * @param foreground - Foreground color (hex)
 * @param background - Background color (hex)
 * @param alpha - Blend factor (0-1)
 */
export function blendHexColors(
  foreground?: string | null,
  background?: string | null,
  alpha = 1,
): string | undefined {
  const fg = normalizeHexColor(foreground);
  const bg = normalizeHexColor(background ?? LIGHT_SURFACE_BASES.default);

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

/* ============================================================================ */
/* PRESET COLORS FOR UI SELECTORS                                              */
/* ============================================================================ */

/**
 * Shared persona swatches for all persona creation flows.
 * Keep this list unified across manual persona creation and imports.
 */
export const PERSONA_SWATCHES = [
  SHARED_PALETTE.primary[500],
  SHARED_PALETTE.primary[700],
  SHARED_PALETTE.info.text,
  SHARED_PALETTE.success.text,
  SHARED_PALETTE.warning.text,
  SHARED_PALETTE.error.text,
  SHARED_PALETTE.accent.violet,
  SHARED_PALETTE.accent.teal,
  SHARED_PALETTE.accent.coral,
  SHARED_PALETTE.accent.slate,
] as const;

/**
 * Persona tint scale shared across the UI.
 */
export const PERSONA_TINT_ALPHA = {
  muted: 0.05,
  body: 0.08,
  header: 0.14,
  interactive: 0.18,
} as const;

/**
 * Backwards-compatible alias for older color picker imports.
 */
export const PERSONA_PRESET_COLORS = PERSONA_SWATCHES;

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
  SHARED_PALETTE.primary[500],
  SHARED_PALETTE.accent.teal,
  SHARED_PALETTE.warning.text,
  SHARED_PALETTE.accent.violet,
  SHARED_PALETTE.accent.slate,
  SHARED_PALETTE.success.text,
  SHARED_PALETTE.accent.lime,
  SHARED_PALETTE.error.text,
] as const;

/**
 * Backwards-compatible alias for import flows until all call sites migrate.
 */
export const WHATSAPP_PERSONA_COLORS = PERSONA_SWATCHES;

/**
 * Default snapshot persona color
 */
export const DEFAULT_SNAPSHOT_PERSONA_COLOR = SHARED_PALETTE.neutral[500];

/**
 * Default response color fallback
 */
export const DEFAULT_RESPONSE_COLOR = SHARED_PALETTE.primary[700];

export const CANVAS_SNAPSHOT_COLOR = SHARED_PALETTE.accent.violet;
export const DEFAULT_BRANCH_COLOR = SHARED_PALETTE.primary[500];
