import { Persona } from "@/lib/types";

export function getPersonaHoverClass(persona: Persona | null, isAttachment = false) {
  if (persona?.is_shadow) return "hover:bg-[color:var(--entry-local-hover,var(--bg-surface-hover))]";
  if (persona) return "hover:bg-surface-subtle";
  if (isAttachment) return "hover:bg-surface-hover";
  return "hover:bg-surface-subtle";
}
