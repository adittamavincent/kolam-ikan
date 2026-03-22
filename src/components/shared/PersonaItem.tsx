import React from "react";
import { Persona } from "@/lib/types";
import { DynamicIcon } from "./DynamicIcon";
import { Fragment } from "react";
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from "@headlessui/react";
import { ChevronDown, FileText } from "lucide-react";
// PersonaIcon removed from this file (unused import)
import { getPersonaHoverClass } from "./getPersonaHoverClass";
import {
  getPersonaScopeDescription,
  getPersonaTypeLabel,
} from "@/lib/personas";

interface PersonaButtonDisplayProps {
  persona: Persona | null;
  isAttachment?: boolean;
  filePersonaName?: string;
  compact?: boolean;
  nameClass?: string;
  showChevron?: boolean;
  showMeta?: boolean;
}

function PersonaButtonDisplay({
  persona,
  isAttachment = false,
  filePersonaName,
  compact = false,
  nameClass = "",
  showChevron = true,
  showMeta = false,
}: PersonaButtonDisplayProps) {
  if (!persona) {
    return (
      <>
        <FileText className="h-3 w-3 text-text-muted" />
        <span className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">
          {isAttachment ? (filePersonaName ?? "Attachment") : "Unknown"}
        </span>
        {showChevron && <ChevronDown className="h-3 w-3 text-text-muted opacity-50" />}
      </>
    );
  }

  return (
    <>
      <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"}`}>
        <div
          className="flex h-4 w-4 items-center justify-center"
          style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
        >
          <DynamicIcon name={persona.icon} className="h-2.5 w-2.5" />
        </div>
        {showMeta ? (
          <div className="min-w-0">
            <div
              className={`${nameClass} truncate ${persona.is_shadow ? "text-amber-700 dark:text-amber-400" : ""}`.trim()}
            >
              {persona.name}
            </div>
            <div className="truncate text-[10px] text-text-muted">
              {getPersonaTypeLabel(persona.type)} • {getPersonaScopeDescription(persona)}
            </div>
          </div>
        ) : (
          <span className={`${nameClass} ${persona.is_shadow ? "text-amber-700 dark:text-amber-400" : ""}`.trim()}>{persona.name}</span>
        )}
      </div>
      {showChevron && <ChevronDown className="h-3 w-3 text-text-muted opacity-50 ml-2" />}
    </>
  );
}

interface PersonaItemProps {
  persona: Persona | null;
  role?: "global" | "shadow" | "default";
  focus?: boolean;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  // when provided, render as a selector control using these menu props
  menuProps?: {
    currentPersona: Persona | null;
    isAttachment: boolean;
    filePersonaName?: string;
    globalPersonas: Persona[];
    shadowPersonas: Persona[];
    onSelect: (personaId: string) => void;
    readOnly?: boolean;
  } | null;
}

export function PersonaItem({
  persona,
  role = "default",
  focus = false,
  onClick,
  compact = false,
  className = "",
  style,
  title,
  menuProps = null,
}: PersonaItemProps) {
  const sharedClass = `${focus ? "bg-surface-subtle text-text-default" : "text-text-subtle"} group flex items-center gap-2 px-2 py-1.5 text-xs transition-colors`;
  const containerClass = `${sharedClass} ${compact ? "border" : "w-full justify-between"} ${className}`;
  const nameClass = role === "shadow" ? "text-amber-700 dark:text-amber-400" : "";

  // If menuProps provided, render as a selector control (Menu + MenuButton + MenuItems)
  if (menuProps) {
    const { currentPersona, isAttachment, filePersonaName, globalPersonas, shadowPersonas, onSelect, readOnly = false } = menuProps;
    // If readOnly is true, render a simple, non-interactive persona display
    // instead of the interactive Menu. This ensures committed entries cannot
    // change persona unless the UI is in amend/edit mode.
    if (readOnly) {
      return (
        <div className={containerClass} style={style} title={title}>
          <PersonaButtonDisplay
            persona={currentPersona}
            isAttachment={isAttachment}
            filePersonaName={filePersonaName}
            compact={compact}
            nameClass={nameClass || "text-[10px] font-medium text-text-subtle  tracking-wider"}
            showChevron={false}
            showMeta={false}
          />
        </div>
      );
    }

    const hoverClass = getPersonaHoverClass(currentPersona, isAttachment);

    return (
      <Menu as="div" className="relative z-30">
        <MenuButton className={`flex items-center gap-2 px-1 py-0.5 ${hoverClass} transition-colors focus:`}>
          <PersonaButtonDisplay
            persona={currentPersona}
            isAttachment={isAttachment}
            filePersonaName={filePersonaName}
            compact={false}
            nameClass="text-[10px] font-medium text-text-subtle tracking-wider"
            showChevron={!readOnly}
            showMeta={false}
          />
        </MenuButton>

        {currentPersona && (
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0"
          >
            <MenuItems
              anchor={{ to: "bottom start", gap: 4 }}
              className="z-9999 w-64 max-h-60 overflow-y-auto overflow-hidden border border-border-default bg-surface-elevated p-1 shadow-2xl"
            >
              <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Switch to...
              </div>
              {globalPersonas.length > 0 && (
                <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                  Available Everywhere
                </div>
              )}
              {globalPersonas.map((p) => (
                <MenuItem key={p.id}>
                  {({ focus }) => (
                    <PersonaItem
                      persona={p}
                      role="global"
                      focus={focus}
                      onClick={() => onSelect(p.id)}
                    />
                  )}
                </MenuItem>
              ))}

              {shadowPersonas.length > 0 && (
                <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Local To This Stream
                </div>
              )}
              {shadowPersonas.map((p) => (
                <MenuItem key={p.id}>
                  {({ focus }) => (
                    <PersonaItem
                      persona={p}
                      role="shadow"
                      focus={focus}
                      onClick={() => onSelect(p.id)}
                    />
                  )}
                </MenuItem>
              ))}
            </MenuItems>
          </Transition>
        )}
      </Menu>
    );
  }

  return (
    <button
      onClick={onClick}
      className={containerClass}
      style={style}
      title={title}
    >
      <PersonaButtonDisplay
        persona={persona}
        compact={compact}
        nameClass={nameClass}
        showChevron={false}
        showMeta={!compact}
      />
    </button>
  );
}
