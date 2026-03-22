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

export function hexToRgba(color?: string | null, alpha = 1): string | undefined {
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

  const int = Number.parseInt(expanded, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  return {
    backgroundColor: hexToRgba(persona.color, backgroundAlpha),
    borderColor: hexToRgba(persona.color, borderAlpha),
  };
}
