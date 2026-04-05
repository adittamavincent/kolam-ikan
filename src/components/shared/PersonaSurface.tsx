import type React from "react";

import type { Persona } from "@/lib/types";
import { getPersonaTintStyle } from "@/lib/personas";

type PersonaSurfaceTone = "body" | "code" | "editor";

const PERSONA_SURFACE_TONES: Record<
  PersonaSurfaceTone,
  { backgroundAlpha: number; borderAlpha: number }
> = {
  body: {
    backgroundAlpha: 0.06,
    borderAlpha: 0.16,
  },
  code: {
    backgroundAlpha: 0.1,
    borderAlpha: 0.2,
  },
  editor: {
    backgroundAlpha: 0.05,
    borderAlpha: 0.15,
  },
};

interface PersonaSurfaceProps {
  persona?: Persona | null;
  tone?: PersonaSurfaceTone;
  as?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function PersonaSurface({
  persona,
  tone = "body",
  as: Component = "div",
  className = "",
  style,
  children,
}: PersonaSurfaceProps) {
  const tintStyle = persona
    ? getPersonaTintStyle(persona, PERSONA_SURFACE_TONES[tone])
    : undefined;

  return (
    <Component
      className={className}
      style={tintStyle ? { ...tintStyle, ...style } : style}
    >
      {children}
    </Component>
  );
}