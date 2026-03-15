import { Persona } from "@/lib/types";
import PersonaItem from "./PersonaItem";

interface PersonaSelectorProps {
  currentPersona: Persona | null;
  isPdf: boolean;
  pdfPersonaName?: string;
  globalPersonas: Persona[];
  shadowPersonas: Persona[];
  onSelect: (personaId: string) => void;
  readOnly?: boolean;
}

export function PersonaSelector({
  currentPersona,
  isPdf,
  pdfPersonaName,
  globalPersonas,
  shadowPersonas,
  onSelect,
  readOnly = false,
}: PersonaSelectorProps) {
  return (
    <PersonaItem
      persona={currentPersona ?? null}
      menuProps={{
        currentPersona,
        isPdf,
        pdfPersonaName,
        globalPersonas,
        shadowPersonas,
        onSelect,
        readOnly,
      }}
    />
  );
}
