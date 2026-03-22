import React from "react";
import { Persona } from "@/lib/types";
import { getPersonaTintStyle } from "@/lib/personas";

function isLocalPersona(
  persona: { is_shadow?: boolean | null } | null | undefined,
): boolean {
  return persona?.is_shadow === true;
}

interface ThreadFrameProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  nested?: boolean;
  className?: string;
  frameClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  frameStyle?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  footerStyle?: React.CSSProperties;
}

export function ThreadFrame({
  header,
  footer,
  children,
  nested = false,
  className = "",
  frameClassName = "",
  headerClassName = "",
  bodyClassName = "",
  footerClassName = "",
  frameStyle,
  headerStyle,
  bodyStyle,
  footerStyle,
}: ThreadFrameProps) {
  return (
    <div className={`${nested ? "relative pl-6" : ""} ${className}`.trim()}>
      {nested && (
        <>
          <div className="pointer-events-none absolute bottom-0 left-2 top-0 w-px bg-border-default/35" />
          <div className="pointer-events-none absolute left-2 top-[1.15rem] h-px w-3 bg-border-default/35" />
        </>
      )}

      <div
        className={`relative border border-border-default/50 bg-surface-default ${frameClassName}`.trim()}
        style={frameStyle}
      >
        {header && (
          <div
            className={`border-b border-border-default/35 px-3 py-2 ${headerClassName}`.trim()}
            style={headerStyle}
          >
            {header}
          </div>
        )}

        {children && (
          <div className={bodyClassName} style={bodyStyle}>
            {children}
          </div>
        )}

        {footer && (
          <div
            className={`border-t border-border-default/35 ${footerClassName}`.trim()}
            style={footerStyle}
          >
            {footer}
          </div>
        )}
      </div>
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
  headerClassName?: string;
  bodyClassName?: string;
  variant?: "default" | "bubble";
}

export function SectionPreset({
  persona,
  isAttachment = false,
  leftHeader,
  centerHeader,
  rightHeader,
  children,
  contentClassName = "",
  className = "",
  headerClassName = "",
  bodyClassName = "",
}: SectionPresetProps) {
  const frameStyle = persona
    ? getPersonaTintStyle(persona, {
        backgroundAlpha: isLocalPersona(persona) ? 0.08 : 0.04,
        borderAlpha: 0.18,
      })
    : undefined;

  const headerStyle = persona
    ? getPersonaTintStyle(persona, {
        backgroundAlpha: isLocalPersona(persona) ? 0.18 : 0.1,
        borderAlpha: 0.24,
      })
    : undefined;

  const bodyStyle = persona
    ? getPersonaTintStyle(persona, {
        backgroundAlpha: isLocalPersona(persona) ? 0.06 : 0.03,
        borderAlpha: 0.16,
      })
    : undefined;

  return (
    <ThreadFrame
      nested
      className={`group ${className}`.trim()}
      frameClassName={isAttachment ? "bg-surface-subtle/25" : ""}
      headerClassName={headerClassName}
      bodyClassName={bodyClassName}
      frameStyle={frameStyle}
      headerStyle={headerStyle}
      bodyStyle={bodyStyle}
      header={
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {leftHeader}
            {centerHeader}
          </div>
          <div className="flex shrink-0 items-center gap-1">{rightHeader}</div>
        </div>
      }
    >
      <div className={contentClassName}>{children}</div>
    </ThreadFrame>
  );
}
