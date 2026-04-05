import React from "react";
import { Persona } from "@/lib/types";
import { getPersonaTintStyle } from "@/lib/personas";

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
              className="pointer-events-none absolute left-2 z-0 w-px bg-slate-200"
              style={topSegmentStyle}
            />
          )}
          {showBottomSegment && (
            <div
              className="pointer-events-none absolute left-2 z-0 w-px bg-slate-200"
              style={{
                top: connectorJointTop,
                bottom: `calc(-1 * ${connectorGapBleed})`,
              }}
            />
          )}
          <div
            className="pointer-events-none absolute left-2 z-0 h-px bg-slate-200"
            style={{ top: connectorJointTop, width: "0.6875rem" }}
          />
        </>
      )}

      <div
        className={`relative z-10 bg-white ${frameClassName}`.trim()}
        style={frameStyle}
      >
        {header && (
          <div className={`px-0 ${headerClassName}`.trim()} style={headerStyle}>
            {header}
          </div>
        )}

        {children && !hideBody && (
          <div className={`${bodyClassName}`.trim()} style={bodyStyle}>
            {children}
          </div>
        )}

        {footer && (
          <div className={`p-1 ${footerClassName}`.trim()} style={footerStyle}>
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
  frameClassName?: string;
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
  frameClassName = "border-slate-300",
}: SectionPresetProps) {
  const frameStyle = persona
    ? getPersonaTintStyle(persona, "muted")
    : undefined;
  const headerStyle = persona
    ? getPersonaTintStyle(persona, "header")
    : undefined;
  const bodyStyle = persona ? getPersonaTintStyle(persona, "body") : undefined;

  return (
    <ThreadFrame
      nested
      nestedConnector={nestedConnector}
      className={`group ${className}`.trim()}
      frameClassName={`${frameClassName} ${isAttachment ? "bg-slate-50" : ""}`.trim()}
      headerClassName={headerClassName}
      bodyClassName={bodyClassName}
      frameStyle={frameStyle}
      headerStyle={headerStyle}
      bodyStyle={bodyStyle}
      header={
        <div className="flex min-w-0 items-center">
          {leftHeader && (
            <div className="flex shrink-0 items-center">{leftHeader}</div>
          )}
          <div className="min-w-0 flex flex-1 items-center">{centerHeader}</div>
          {rightHeader && (
            <div className="ml-auto flex shrink-0 items-center">
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
