"use client";

import { forwardRef, ReactNode } from "react";
import { Dialog } from "@headlessui/react";

type DialogCardProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  panelClassName?: string;
};

export const DialogCard = forwardRef<HTMLDivElement, DialogCardProps>(
  function DialogCard(
    {
      title,
      description,
      icon,
      actions,
      children,
      panelClassName = "",
    },
    ref,
  ) {
    return (
      <Dialog.Panel
        ref={ref}
        className={`w-full max-w-lg border border-border-default bg-surface-default p-6 text-left ${panelClassName}`.trim()}
      >
        <div className="flex items-start gap-3">
          {icon ? (
            <div className="border border-border-default bg-surface-subtle/80 p-2">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-1">
            <Dialog.Title className="text-base font-semibold text-text-default">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description as="div" className="text-sm text-text-muted">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
        </div>

        {children ? <div className="mt-4">{children}</div> : null}
        {actions ? (
          <div className="mt-6 flex items-center justify-end gap-2">{actions}</div>
        ) : null}
      </Dialog.Panel>
    );
  },
);
