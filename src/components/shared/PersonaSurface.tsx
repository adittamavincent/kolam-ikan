import type React from "react";

import type { Persona } from "@/lib/types";
import { getPersonaTintStyle, type PersonaTintTone } from "@/lib/personas";

type PersonaSurfaceTone = "body" | "code" | "editor";

const PERSONA_SURFACE_TONES: Record<PersonaSurfaceTone, PersonaTintTone> = {
  body: "body",
  code: "body",
  editor: "body",
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
  className="",
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
