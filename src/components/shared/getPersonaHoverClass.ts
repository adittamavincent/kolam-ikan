import { Persona } from "@/lib/types";

export function getPersonaHoverClass(persona: Persona | null, isAttachment = false) {
  if (persona?.is_shadow) return "hover:bg-amber-500/20";
  if (persona) return "hover:bg-surface-subtle";
  if (isAttachment) return "hover:bg-surface-subtle/70";
  return "hover:bg-surface-subtle";
}
