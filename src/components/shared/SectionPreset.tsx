import React from "react";
import { Persona } from "@/lib/types";
import { PersonaSectionBackground, PersonaSectionHeader } from "./PersonaDisplay";

interface SectionPresetProps {
  persona: Persona | null;
  isPdf?: boolean;
  leftHeader?: React.ReactNode;
  centerHeader: React.ReactNode;
  rightHeader?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

export function SectionPreset({
  persona,
  isPdf = false,
  leftHeader,
  centerHeader,
  rightHeader,
  children,
  contentClassName = "",
  className = "flex flex-col",
}: SectionPresetProps) {
  return (
    <PersonaSectionBackground persona={persona} isPdf={isPdf} className={`flex flex-col ${className}`}>
      <PersonaSectionHeader persona={persona} isPdf={isPdf}>
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