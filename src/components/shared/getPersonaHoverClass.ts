import { Persona } from "@/lib/types";

export function getPersonaHoverClass(persona: Persona | null, isPdf = false) {
  if (persona?.type === "AI") return "hover:bg-sky-500/20";
  if (persona?.is_shadow) return "hover:bg-amber-500/20";
  if (isPdf) return "hover:bg-surface-subtle/70";
  return "hover:bg-surface-subtle";
}
