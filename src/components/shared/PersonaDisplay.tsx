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
      className={`flex items-center justify-center transition-all hover:scale-105 ${sizeClasses[size]} ${onClick ? "cursor-pointer" : ""} ${className}`}
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
