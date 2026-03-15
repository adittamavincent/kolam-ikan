"use client";

import { DynamicIcon } from "./DynamicIcon";

interface Persona {
  id: string;
  name: string;
  color: string;
  icon: string;
  is_shadow?: boolean | null;
  type?: string | null;
}

function isShadowPersona(persona: Persona): boolean {
  return persona.is_shadow === true;
}

function isAiPersona(persona: Persona): boolean {
  return persona.type === "AI";
}

interface PersonaIconProps {
  persona: Persona | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  title?: string;
}

export function PersonaIcon({
  persona,
  size = "md",
  className = "",
  onClick,
  title,
}: PersonaIconProps) {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  const iconSizeClasses = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <div
      className={`flex items-center justify-center rounded transition-all hover:scale-105 ${sizeClasses[size]} ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{
        backgroundColor: `${persona?.color || "#94a3b8"}15`,
        color: persona?.color || "#94a3b8",
      }}
      onClick={onClick}
      title={title || `Author: ${persona?.name || "Unknown"}`}
    >
      <DynamicIcon
        name={persona?.icon || "user"}
        className={iconSizeClasses[size]}
      />
    </div>
  );
}

interface PersonaBadgeProps {
  persona: Persona | null;
  showShadowBadge?: boolean;
  showAiBadge?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function PersonaBadge({
  persona,
  showShadowBadge = true,
  showAiBadge = true,
  size = "md",
  className = "",
}: PersonaBadgeProps) {
  if (!persona) return null;

  const textSizeClass = size === "sm" ? "text-[10px]" : "text-[10px]";
  const badgeSizeClass = size === "sm" ? "text-[9px]" : "text-[9px]";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`${textSizeClass} font-medium text-text-subtle`}>
        {persona.name}
      </span>
      {showShadowBadge && isShadowPersona(persona) && (
        <span className={`border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 ${badgeSizeClass} text-amber-700 dark:text-amber-400`}>
          Shadow
        </span>
      )}
      {showAiBadge && isAiPersona(persona) && (
        <span className={`border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 ${badgeSizeClass} text-sky-700 dark:text-sky-400`}>
          AI
        </span>
      )}
    </div>
  );
}

interface PersonaSectionBackgroundProps {
  persona: Persona | null;
  isPdf?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function PersonaSectionBackground({
  persona,
  isPdf = false,
  children,
  className = "",
}: PersonaSectionBackgroundProps) {
  const bgClass =
    persona && isAiPersona(persona)
      ? "bg-sky-500/5"
      : persona && isShadowPersona(persona)
        ? "bg-amber-500/5"
        : isPdf
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
  isPdf?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function PersonaSectionHeader({
  persona,
  isPdf = false,
  children,
  className = "",
}: PersonaSectionHeaderProps) {
  const headerBgClass =
    persona && isAiPersona(persona)
      ? "bg-sky-500/10 border-sky-500/20"
      : persona && isShadowPersona(persona)
        ? "bg-amber-500/10 border-amber-500/20"
        : "bg-surface-subtle/50 border-border-subtle/70";

  return (
    <div
      className={`flex items-center justify-between px-4 ${isPdf ? "py-1.5" : "py-1"} border-y ${headerBgClass} ${className}`}
    >
      {children}
    </div>
  );
}