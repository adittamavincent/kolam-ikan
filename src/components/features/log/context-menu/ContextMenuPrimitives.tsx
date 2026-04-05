"use client";

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  RefObject,
} from "react";
import { createPortal } from "react-dom";

export const CONTEXT_MENU_BASE_CONTAINER_CLASS =
  "fixed z-50 border border-slate-300 bg-slate-100 p-1.5";
export const CONTEXT_MENU_SCROLL_CONTAINER_CLASS =
  "max-h-[calc(100vh-16px)] overflow-y-auto";
export const CONTEXT_MENU_HEADER_CLASS =
  "px-2 py-1 mb-0.5 flex items-center gap-1.5";
export const CONTEXT_MENU_DIVIDER_CLASS = "my-1 h-px bg-slate-200";
export const CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS =
  "h-px bg-slate-200 mb-0.5";
export const CONTEXT_MENU_SECTION_LABEL_CLASS =
  "mb-0.5 px-1.5 pt-0.5 pb-0.5 uppercase tracking-widest text-slate-500";
export const CONTEXT_MENU_ACTION_CLASS =
  "flex w-full items-center gap-2 px-2 py-1.5 text-slate-800 hover:bg-slate-50";
export const CONTEXT_MENU_ACTION_ICON_CLASS = "h-3.5 w-3.5 text-slate-500";
export const CONTEXT_MENU_DANGER_ACTION_CLASS =
  "flex w-full items-center gap-2 px-2 py-1.5 text-rose-700 hover:bg-rose-100";
export const CONTEXT_MENU_DISABLED_ACTION_CLASS =
  "disabled:cursor-not-allowed disabled:text-slate-500";

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

interface ContextMenuPortalProps {
  children: ReactNode;
  menuRef?: RefObject<HTMLDivElement | null>;
  position: {
    left: number;
    top: number;
  };
  className?: string;
  role?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function ContextMenuPortal({
  children,
  menuRef,
  position,
  className,
  role = "menu",
  ariaLabel,
  style,
}: ContextMenuPortalProps) {
  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      style={{
        top: position.top,
        left: position.left,
        ...style,
      }}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuSectionLabel({ children }: { children: ReactNode }) {
  return <div className={CONTEXT_MENU_SECTION_LABEL_CLASS}>{children}</div>;
}

export function ContextMenuDivider() {
  return <div className={CONTEXT_MENU_DIVIDER_CLASS} />;
}

interface ContextMenuActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export function ContextMenuActionButton({
  danger = false,
  className,
  type = "button",
  ...props
}: ContextMenuActionButtonProps) {
  return (
    <button
      type={type}
      className={joinClasses(
        danger ? CONTEXT_MENU_DANGER_ACTION_CLASS : CONTEXT_MENU_ACTION_CLASS,
        CONTEXT_MENU_DISABLED_ACTION_CLASS,
        className,
      )}
      {...props}
    />
  );
}
