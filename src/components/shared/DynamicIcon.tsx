'use client';

import { icons } from 'lucide-react';
import { LucideIcon } from 'lucide-react';

interface DynamicIconProps {
  name: string;
  className?: string;
}

export function DynamicIcon({ name, className }: DynamicIconProps) {
  // Normalize name to PascalCase if needed, but assuming seed data matches Lucide export names (mostly)
  // Seed data has: 'terminal', 'briefcase', 'dumbbell', 'graduation-cap', 'users'
  // Lucide exports: Terminal, Briefcase, Dumbbell, GraduationCap, Users
  
  // Helper to convert kebab-case to PascalCase
  const pascalName = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  const IconComponent = (icons as Record<string, LucideIcon>)[pascalName] || (icons as Record<string, LucideIcon>)[name];

  if (!IconComponent) {
    // Fallback or return null
    return <span className={className}>{name.substring(0, 2).toUpperCase()}</span>;
  }

  return <IconComponent className={className} />;
}
