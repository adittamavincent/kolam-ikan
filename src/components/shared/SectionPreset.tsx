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
  hideBody?: boolean;
  nested?: boolean;
  nestedConnector?: "single" | "first" | "middle" | "last";
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
  hideBody = false,
  nested = false,
  nestedConnector = "single",
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
  const connectorJointTop = "0.875rem";
  const connectorGapBleed = "0.5rem";
  const showTopSegment =
    nestedConnector === "first" ||
    nestedConnector === "middle" ||
    nestedConnector === "last" ||
    nestedConnector === "single";
  const showBottomSegment =
    nestedConnector === "first" || nestedConnector === "middle";
  const topSegmentStyle =
    nestedConnector === "first" || nestedConnector === "single"
      ? {
          top: "0",
          height: connectorJointTop,
        }
      : {
          top: `calc(-1 * ${connectorGapBleed})`,
          height: `calc(${connectorJointTop} + ${connectorGapBleed})`,
        };

  return (
    <div className={`${nested ? "relative pl-5" : ""} ${className}`.trim()}>
      {nested && (
        <>
          {showTopSegment && (
            <div
              className="pointer-events-none absolute left-2 z-0 w-px bg-border-default"
              style={topSegmentStyle}
            />
          )}
          {showBottomSegment && (
            <div
              className="pointer-events-none absolute left-2 z-0 w-px bg-border-default"
              style={{
                top: connectorJointTop,
                bottom: `calc(-1 * ${connectorGapBleed})`,
              }}
            />
          )}
          <div
            className="pointer-events-none absolute left-2 z-0 h-px bg-border-default"
            style={{ top: connectorJointTop, width: "0.6875rem" }}
          />
        </>
      )}

      <div
        className={`relative z-10 border border-border-default/50 bg-surface-default ${frameClassName}`.trim()}
        style={frameStyle}
      >
        {header && (
          <div
            className={`${hideBody ? "" : "border-b border-border-default/35"} px-0.75 ${headerClassName}`.trim()}
            style={headerStyle}
          >
            {header}
          </div>
        )}

        {children && !hideBody && (
          <div className={`${bodyClassName}`.trim()} style={bodyStyle}>
            {children}
          </div>
        )}

        {footer && (
          <div
            className={`border-t border-border-default/35 p-1 ${footerClassName}`.trim()}
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
  nestedConnector?: "single" | "first" | "middle" | "last";
  leftHeader?: React.ReactNode;
  centerHeader: React.ReactNode;
  rightHeader?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}

export function SectionPreset({
  persona,
  isAttachment = false,
  nestedConnector = "single",
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
      nestedConnector={nestedConnector}
      className={`group ${className}`.trim()}
      frameClassName={isAttachment ? "bg-surface-subtle/25" : ""}
      headerClassName={headerClassName}
      bodyClassName={bodyClassName}
      frameStyle={frameStyle}
      headerStyle={headerStyle}
      bodyStyle={bodyStyle}
      header={
        <div className="flex min-w-0 items-center gap-1.5">
          {leftHeader && <div className="flex shrink-0 items-center">{leftHeader}</div>}
          <div className="min-w-0 flex flex-1 items-center">{centerHeader}</div>
          {rightHeader && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {rightHeader}
            </div>
          )}
        </div>
      }
    >
      <div className={contentClassName}>{children}</div>
    </ThreadFrame>
  );
}
