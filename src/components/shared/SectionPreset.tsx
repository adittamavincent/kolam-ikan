import React from "react";
import { Persona } from "@/lib/types";

function isShadowPersona(persona: { is_shadow?: boolean | null } | null | undefined): boolean {
  return persona?.is_shadow === true;
}

function isAiPersona(persona: { type?: string | null } | null | undefined): boolean {
  return persona?.type === "AI";
}

interface PersonaSectionBackgroundProps {
  persona: Persona | null;
  isAttachment?: boolean;
  children: React.ReactNode;
  className?: string;
}

function PersonaSectionBackground({
  persona,
  isAttachment = false,
  children,
  className = "",
}: PersonaSectionBackgroundProps) {
  const bgClass =
    persona && isAiPersona(persona)
      ? "bg-sky-500/5"
      : persona && isShadowPersona(persona)
      ? "bg-amber-500/5"
      : isAttachment
      ? "bg-surface-subtle/25"
      : "";

  return (
    <div className={`flex flex-col ${bgClass} ${className}`}>
      {children}
    </div>
  );
}

interface PersonaSectionHeaderProps {
  persona: Persona | null;
  isAttachment?: boolean;
  children: React.ReactNode;
  className?: string;
}

function PersonaSectionHeader({
  persona,
  isAttachment = false,
  children,
  className = "",
}: PersonaSectionHeaderProps) {
  const headerBgClass =
    persona && isAiPersona(persona)
      ? "bg-sky-500/10 border-border-default/20"
      : persona && isShadowPersona(persona)
      ? "bg-amber-500/10 border-border-default/20"
      : "bg-surface-subtle/50 border-border-default/70";

  return (
    <div
      className={`flex items-center justify-between px-4 ${isAttachment ? "py-1.5" : "py-1"} border-y ${headerBgClass} ${className}`}
    >
      {children}
    </div>
  );
}

interface SectionPresetProps {
  persona: Persona | null;
  isAttachment?: boolean;
  leftHeader?: React.ReactNode;
  centerHeader: React.ReactNode;
  rightHeader?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

export function SectionPreset({
  persona,
  isAttachment = false,
  leftHeader,
  centerHeader,
  rightHeader,
  children,
  contentClassName = "",
  className = "flex flex-col",
}: SectionPresetProps) {
  return (
    <PersonaSectionBackground persona={persona} isAttachment={isAttachment} className={`flex flex-col ${className}`}>
      <PersonaSectionHeader persona={persona} isAttachment={isAttachment}>
        <div className="flex items-center gap-2">
          {leftHeader}
          {centerHeader}
        </div>
        <div className="flex items-center gap-1">
          {rightHeader}
        </div>
      </PersonaSectionHeader>
      <div className={contentClassName}>
        {children}
      </div>
    </PersonaSectionBackground>
  );
}