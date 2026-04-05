import { Persona } from "@/lib/types";
import {
  normalizeHexColor,
  blendHexColors,
  DARK_MODE,
  PERSONA_TINT_ALPHA,
} from "@/lib/theme/colors";

export const AI_PERSONA_TYPE = "AI";
export const DEFAULT_PERSONA_TYPE = "Perspective";
export const DEFAULT_IMPORTED_PERSONA_TYPE = "Participant";

type PersonaScope = Pick<Persona, "color" | "is_shadow" | "type">;
type PersonaColorSource = PersonaScope | { color: string } | string;
export type PersonaTintTone = keyof typeof PERSONA_TINT_ALPHA;

const PERSONA_TINT_BASE_SURFACES: Record<PersonaTintTone, string> = {
  muted: DARK_MODE.surface.default,
  body: DARK_MODE.surface.default,
  header: DARK_MODE.surface.subtle,
  interactive: DARK_MODE.surface.elevated,
};

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

function resolvePersonaColor(persona?: PersonaColorSource | null): string | undefined {
  if (!persona) return undefined;
  if (typeof persona === "string") return normalizeHexColor(persona);

  return normalizeHexColor(persona.color);
}

export function getPersonaTintStyle(
  persona?: PersonaScope | null,
  options?:
    | PersonaTintTone
    | {
        backgroundAlpha?: number;
        backgroundBase?: string;
      },
) {
  if (!persona) return undefined;

  const tone = typeof options === "string" ? options : "body";
  const backgroundAlpha =
    (typeof options === "string" ? undefined : options?.backgroundAlpha) ??
    PERSONA_TINT_ALPHA[tone];
  const baseSurface =
    (typeof options === "string" ? undefined : options?.backgroundBase) ??
    PERSONA_TINT_BASE_SURFACES[tone];
  const backgroundColor = blendHexColors(persona.color, baseSurface, backgroundAlpha);
  const borderColor = normalizeHexColor(persona.color);

  return {
    backgroundColor: backgroundColor ?? baseSurface,
    borderColor: borderColor ?? "var(--border-default)",
  };
}

export function getPersonaAccentStyle(
  persona?: PersonaColorSource | null,
  tone: PersonaTintTone = "header",
) {
  const color = resolvePersonaColor(persona);

  return {
    backgroundColor:
      blendHexColors(color, PERSONA_TINT_BASE_SURFACES[tone], PERSONA_TINT_ALPHA[tone]) ??
      PERSONA_TINT_BASE_SURFACES[tone],
    borderColor: color ?? "var(--border-default)",
    color: color ?? "var(--text-default)",
  };
}
