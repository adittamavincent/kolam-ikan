import { Persona } from "@/lib/types";
import {
  normalizeHexColor,
  blendHexColors,
  DARK_MODE,
} from "@/lib/theme/colors";

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

/**
 * Normalize persona color to #RRGGBB format
 * @deprecated Use normalizeHexColor from @/lib/theme/colors instead
 */
export function normalizePersonaColor(color?: string | null): string | undefined {
  return normalizeHexColor(color);
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
      ? DARK_MODE.surface.elevated
      : backgroundAlpha >= 0.08
        ? DARK_MODE.surface.subtle
        : DARK_MODE.surface.default;
  const backgroundColor = blendHexColors(persona.color, baseSurface, backgroundAlpha);
  const borderColor = blendHexColors(persona.color, DARK_MODE.surface.default, borderAlpha);

  return {
    backgroundColor: backgroundColor ?? baseSurface,
    borderColor: borderColor ?? "var(--border-default)",
  };
}
