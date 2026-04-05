import { Persona } from "@/lib/types";

export function getPersonaHoverClass(
  _persona: Persona | null,
  isAttachment = false,
) {
  if (_persona) return "hover:bg-slate-50";
  if (isAttachment) return "hover:bg-slate-200";
  return "hover:bg-slate-50";
}
