"use client";

import type { ReactNode } from "react";

interface LogTimelineProps {
  children: ReactNode;
  className?: string;
}

export function LogTimeline({ children, className }: LogTimelineProps) {
  return <div className={className}>{children}</div>;
}
