import { Persona } from "@/lib/types";

export const AI_PERSONA_TYPE = "AI";
export const DEFAULT_PERSONA_TYPE = "Perspective";
export const DEFAULT_IMPORTED_PERSONA_TYPE = "Participant";

type PersonaScope = Pick<Persona, "color" | "is_shadow" | "type">;

function trimPersonaType(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isAiPersonaType(value?: string | null): boolean {
  return trimPersonaType(value).toUpperCase() === AI_PERSONA_TYPE;
}

export function getPersonaTypeLabel(value?: string | null): string {
  const trimmed = trimPersonaType(value);
  if (!trimmed) return DEFAULT_PERSONA_TYPE;

  if (trimmed.toUpperCase() === "HUMAN") {
    return DEFAULT_PERSONA_TYPE;
  }

  return trimmed;
}

export function sanitizePersonaTypeInput(
  value?: string | null,
  fallback = DEFAULT_PERSONA_TYPE,
): string {
  const trimmed = trimPersonaType(value);
  if (!trimmed) return fallback;

  const normalized = getPersonaTypeLabel(trimmed);
  return normalized.slice(0, 40).trim() || fallback;
}

export function getPersonaScopeLabel(
  persona?: Pick<Persona, "is_shadow"> | null,
): string {
  return persona?.is_shadow ? "Local" : "Global";
}

export function getPersonaScopeDescription(
  persona?: Pick<Persona, "is_shadow"> | null,
): string {
  return persona?.is_shadow
    ? "Only available in this stream"
    : "Available across your workspace";
}

export function normalizePersonaColor(color?: string | null): string | undefined {
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

function blendHex(
  foreground?: string | null,
  background = "#21252b",
  alpha = 1,
): string | undefined {
  const fg = normalizePersonaColor(foreground);
  const bg = normalizePersonaColor(background);

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

export function getPersonaTintStyle(
  persona?: PersonaScope | null,
  options?: {
    backgroundAlpha?: number;
    borderAlpha?: number;
  },
) {
  if (!persona) return undefined;

  const backgroundAlpha = options?.backgroundAlpha ?? 0.06;
  const borderAlpha = options?.borderAlpha ?? 0.18;
  const baseSurface =
    backgroundAlpha >= 0.12
      ? "#2c313a"
      : backgroundAlpha >= 0.08
        ? "#282c34"
        : "#21252b";
  const backgroundColor = blendHex(persona.color, baseSurface, backgroundAlpha);
  const borderColor = blendHex(persona.color, "#21252b", borderAlpha);

  return {
    backgroundColor: backgroundColor ?? baseSurface,
    borderColor: borderColor ?? "var(--border-default)",
  };
}
