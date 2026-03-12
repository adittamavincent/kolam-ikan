import React from "react";
import { Plus } from "lucide-react";

interface NavigatorCreateButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: React.ReactNode;
}

export const NavigatorCreateButton = React.forwardRef<
  HTMLButtonElement,
  NavigatorCreateButtonProps
>(({ label, icon, className, disabled, ...props }, ref) => {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg/40 ${
        disabled
          ? "cursor-not-allowed text-text-muted/60 opacity-70"
          : "text-text-muted hover:bg-surface-subtle hover:text-text-default active:bg-surface-subtle/80"
      } ${className || ""}`}
      {...props}
    >
      {icon || <Plus className="h-4 w-4" />}
      <span>{label}</span>
    </button>
  );
});

NavigatorCreateButton.displayName = "NavigatorCreateButton";
