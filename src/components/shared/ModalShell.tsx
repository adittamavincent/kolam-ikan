"use client";

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { X } from "lucide-react";
import { Fragment, ReactNode, Ref } from "react";

export type ModalCloseReason = "dismiss" | "close-button";

type ModalShellProps = {
  open: boolean;
  children: ReactNode;
  onClose?: () => void;
  onRequestClose?: (reason: ModalCloseReason) => void;
  panelClassName?: string;
  viewportClassName?: string;
  contentClassName?: string;
  backdropClassName?: string;
  dialogClassName?: string;
  panelRef?: Ref<HTMLDivElement>;
  dismissable?: boolean;
};

type ModalHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  onClose?: () => void;
  closeDisabled?: boolean;
  className?: string;
  headingClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  metaClassName?: string;
};

type ModalCloseButtonProps = {
  onClick: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  iconClassName?: string;
};

function joinClassNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function ModalShell({
  open,
  children,
  onClose,
  onRequestClose,
  panelClassName,
  viewportClassName,
  contentClassName,
  backdropClassName,
  dialogClassName,
  panelRef,
  dismissable = true,
}: ModalShellProps) {
  const requestClose = (reason: ModalCloseReason) => {
    if (onRequestClose) {
      onRequestClose(reason);
      return;
    }
    onClose?.();
  };

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className={joinClassNames("relative z-50", dialogClassName)}
        onClose={dismissable ? () => requestClose("dismiss") : () => {}}
      >
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className={joinClassNames(
              "fixed inset-0 bg-surface-dark backdrop-blur-sm",
              backdropClassName,
            )}
          />
        </TransitionChild>

        <div
          className={joinClassNames(
            "fixed inset-0 overflow-y-auto p-4",
            viewportClassName,
          )}
        >
          <div
            className={joinClassNames(
              "flex min-h-full items-center justify-center",
              contentClassName,
            )}
          >
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100 translate-y-0"
              leaveTo="opacity-0 translate-y-4"
            >
              <DialogPanel
                ref={panelRef}
                className={joinClassNames(
                  "w-full max-w-2xl border border-border-default bg-surface-default transition-all",
                  panelClassName,
                )}
              >
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

export function ModalCloseButton({
  onClick,
  label = "Close dialog",
  className,
  disabled = false,
  iconClassName,
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={joinClassNames(
        "inline-flex h-8 w-8 items-center justify-center text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <X className={joinClassNames("h-4 w-4", iconClassName)} />
    </button>
  );
}

export function ModalHeader({
  title,
  description,
  icon,
  meta,
  onClose,
  closeDisabled = false,
  className,
  headingClassName,
  titleClassName,
  descriptionClassName,
  metaClassName,
}: ModalHeaderProps) {
  return (
    <div
      className={joinClassNames(
        "flex items-center justify-between gap-4 border-b border-border-default py-5",
        className,
      )}
    >
      <div className={joinClassNames("min-w-0 flex-1", headingClassName)}>
        <div className="flex items-center gap-2">
          {icon ? (
            <div className="shrink-0 text-action-primary-bg">{icon}</div>
          ) : null}
          <DialogTitle
            as="h2"
            className={joinClassNames(
              "text-lg font-semibold text-text-default",
              titleClassName,
            )}
          >
            {title}
          </DialogTitle>
        </div>
        {description ? (
          <p
            className={joinClassNames(
              "mt-1 text-sm text-text-muted",
              descriptionClassName,
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {meta || onClose ? (
        <div
          className={joinClassNames(
            "flex shrink-0 items-center gap-2",
            metaClassName,
          )}
        >
          {meta}
          {onClose ? (
            <ModalCloseButton onClick={onClose} disabled={closeDisabled} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
