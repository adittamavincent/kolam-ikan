import React from "react";
import { Persona } from "@/lib/types";
import { DynamicIcon } from "./DynamicIcon";
import { Fragment } from "react";
import {
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  Transition,
} from "@headlessui/react";
import { ChevronDown, FileText } from "lucide-react";
// PersonaIcon removed from this file (unused import)
import { getPersonaAccentStyle, getPersonaTypeLabel } from "@/lib/personas";

interface PersonaButtonDisplayProps {
  persona: Persona | null;
  isAttachment?: boolean;
  filePersonaName?: string;
  nameClass?: string;
  showChevron?: boolean;
  showMeta?: boolean;
  showTypeBadge?: boolean;
}

function PersonaButtonDisplay({
  persona,
  isAttachment = false,
  filePersonaName,
  nameClass = "",
  showChevron = true,
  showMeta = false,
  showTypeBadge = true,
}: PersonaButtonDisplayProps) {
  const personaTypeLabel =
    getPersonaTypeLabel(persona?.type ?? "") || "Unknown";

  if (!persona) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="persona-button-display__fallback-icon h-4 w-4 text-text-muted" />
        <span className="text-text-subtle uppercase tracking-wider">
          {isAttachment ? (filePersonaName ?? "Attachment") : "Unknown"}
        </span>
        {showChevron && (
          <ChevronDown className="persona-button-display__chevron h-4 w-4 text-text-muted" />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="persona-button-display__icon flex h-4 w-4 items-center justify-center"
          style={getPersonaAccentStyle(persona, "header")}
        >
          <DynamicIcon name={persona.icon} className="h-4 w-4" />
        </div>
        {showMeta ? (
          <div className="min-w-0">
            <div
              className={`${nameClass} truncate ${persona.is_shadow ? "persona-button-display__name--local" : ""}`.trim()}
            >
              {persona.name}
            </div>
            <div className="truncate text-text-muted">
              {getPersonaTypeLabel(persona.type)}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`${nameClass} truncate ${persona.is_shadow ? "persona-button-display__name--local" : ""}`.trim()}
            >
              {persona.name}
            </span>
            {showTypeBadge && (
              <span className="persona-button-display__type-badge shrink-0 uppercase">
                {personaTypeLabel}
              </span>
            )}
          </div>
        )}
      </div>
      {showChevron && (
        <ChevronDown className="persona-button-display__chevron h-4 w-4 text-text-muted opacity-50" />
      )}
    </div>
  );
}

interface PersonaItemProps {
  persona: Persona | null;
  role?: "global" | "local" | "default";
  focus?: boolean;
  onClick?: () => void;
  compact?: boolean;
  showMeta?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  showTypeBadge?: boolean;
  // when provided, render as a selector control using these menu props
  menuProps?: {
    currentPersona: Persona | null;
    isAttachment: boolean;
    filePersonaName?: string;
    globalPersonas: Persona[];
    localPersonas: Persona[];
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
  showMeta,
  className = "",
  style,
  title,
  showTypeBadge = true,
  menuProps = null,
}: PersonaItemProps) {
  const sharedClass = compact
    ? `${focus ? "bg-surface-subtle text-text-default" : "text-text-subtle"} group flex items-center gap-1 leading-4 transition-colors`
    : `${focus ? "bg-surface-subtle text-text-default" : "text-text-subtle"} group flex items-center gap-2 leading-4 transition-colors`;
  const containerClass = `${sharedClass} ${compact ? "border" : "w-full justify-between"} text-left ${className}`;
  const nameClass =
    role === "local" ? "persona-button-display__name--local" : "";
  const resolvedShowMeta = showMeta ?? !compact;

  // If menuProps provided, render as a selector control (Menu + MenuButton + MenuItems)
  if (menuProps) {
    const {
      currentPersona,
      isAttachment,
      filePersonaName,
      globalPersonas,
      localPersonas,
      onSelect,
      readOnly = false,
    } = menuProps;
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
            nameClass={nameClass || "text-text-subtle tracking-wider"}
            showChevron={false}
            showMeta={false}
          />
        </div>
      );
    }

    return (
      <Menu as="div" className="relative z-30">
        <MenuButton className="flex items-center gap-2 leading-4">
          <PersonaButtonDisplay
            persona={currentPersona}
            isAttachment={isAttachment}
            filePersonaName={filePersonaName}
            nameClass="text-text-subtle tracking-wider"
            showChevron={!readOnly}
            showMeta={false}
          />
        </MenuButton>

        {currentPersona && (
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom=""
            enterTo=""
            leave="transition ease-in duration-75"
            leaveFrom=""
            leaveTo=""
          >
            <MenuItems
              anchor={{ to: "bottom start", gap: 4 }}
              className="z-9999 w-fit min-w-56 max-w-[calc(100vw-2rem)] max-h-60 overflow-x-hidden overflow-y-auto border border-border-default bg-surface-elevated p-2"
            >
              <div className="text-text-muted uppercase tracking-wider">
                Switch to...
              </div>
              {globalPersonas.length > 0 && (
                <div className="text-text-muted">Available Everywhere</div>
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

              {localPersonas.length > 0 && (
                <div className="persona-button-display__local-label mt-1 px-2 py-1">
                  Local To This Stream
                </div>
              )}
              {localPersonas.map((p) => (
                <MenuItem key={p.id}>
                  {({ focus }) => (
                    <PersonaItem
                      persona={p}
                      role="local"
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
        nameClass={nameClass}
        showChevron={false}
        showMeta={resolvedShowMeta}
        showTypeBadge={showTypeBadge}
      />
    </button>
  );
}
