import { Persona } from "@/lib/types";
import { Fragment } from "react";
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from "@headlessui/react";
import { Check, ChevronDown, FileText } from "lucide-react";
import { PersonaIcon, PersonaBadge } from "./PersonaDisplay";
import { DynamicIcon } from "./DynamicIcon";
import { getPersonaHoverClass } from "./getPersonaHoverClass";

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
  const hoverClass = getPersonaHoverClass(currentPersona, isPdf);
  const buttonContent = (
    <>
      {currentPersona ? (
        <>
          <PersonaIcon persona={currentPersona} size="sm" />
          <PersonaBadge persona={currentPersona} size="sm" />
          {!readOnly && <ChevronDown className="h-3 w-3 text-text-muted opacity-50" />}
        </>
      ) : (
        <>
          <FileText className="h-3 w-3 text-text-muted" />
          <span className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">
            {isPdf ? (pdfPersonaName ?? "Attachment") : "Unknown"}
          </span>
          {!readOnly && <ChevronDown className="h-3 w-3 text-text-muted opacity-50" />}
        </>
      )}
    </>
  );

  if (readOnly) {
    return (
      <div className={`flex items-center gap-2 px-1 py-0.5 rounded transition-colors`}>
        {buttonContent}
      </div>
    );
  }

  return (
    <Menu as="div" className="relative z-30">
      <MenuButton className={`flex items-center gap-2 px-1 py-0.5 rounded ${hoverClass} transition-colors focus:`}>
        {buttonContent}
      </MenuButton>

      {currentPersona && (
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <MenuItems
            anchor={{ to: "bottom start", gap: 4 }}
            className="z-9999 w-48 max-h-60 overflow-y-auto overflow-hidden border border-border-default bg-surface-elevated p-1 shadow-2xl"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Switch to...
            </div>
            {globalPersonas.length > 0 && (
              <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                Global Personas
              </div>
            )}
            {globalPersonas.map((p) => (
              <MenuItem key={p.id}>
                {({ focus }) => (
                  <button
                    onClick={() => onSelect(p.id)}
                    className={`${
                      focus ? "bg-surface-subtle text-text-default" : "text-text-subtle"
                    } group flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors`}
                  >
                    <div
                      className="flex h-4 w-4 items-center justify-center rounded"
                      style={{ backgroundColor: `${p.color}20`, color: p.color }}
                    >
                      <DynamicIcon name={p.icon} className="h-2.5 w-2.5" />
                    </div>
                    <span>{p.name}</span>
                    <span className="ml-auto border border-border-default bg-surface-subtle px-1.5 py-0.5 text-[9px] rounded text-text-muted">
                      Global
                    </span>
                    {p.id === currentPersona?.id && <Check className="h-3 w-3" />}
                  </button>
                )}
              </MenuItem>
            ))}

            {shadowPersonas.length > 0 && (
              <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Shadow Personas
              </div>
            )}
            {shadowPersonas.map((p) => (
              <MenuItem key={p.id}>
                {({ focus }) => (
                  <button
                    onClick={() => onSelect(p.id)}
                    className={`${
                      focus ? "bg-amber-500/10 text-text-default" : "text-text-subtle"
                    } group flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors`}
                  >
                    <div
                      className="flex h-4 w-4 items-center justify-center   rounded"
                      style={{ backgroundColor: `${p.color}20`, color: p.color }}
                    >
                      <DynamicIcon name={p.icon} className="h-2.5 w-2.5" />
                    </div>
                    <span>{p.name}</span>
                    <span className="ml-auto border border-border-default/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] rounded text-amber-700 dark:text-amber-400">
                      Shadow
                    </span>
                    {p.id === currentPersona?.id && <Check className="h-3 w-3" />}
                  </button>
                )}
              </MenuItem>
            ))}
          </MenuItems>
        </Transition>
      )}
    </Menu>
  );
}
