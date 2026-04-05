import { Persona } from "@/lib/types";

export function getPersonaHoverClass(
  _persona: Persona | null,
  isAttachment = false,
) {
  if (_persona) return "hover:bg-surface-subtle";
  if (isAttachment) return "hover:bg-surface-hover";
  return "hover:bg-surface-subtle";
}
