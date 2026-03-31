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
export type ModalFooterActionTone =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost";

export type ModalFooterAction = {
  id?: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  form?: string;
  disabled?: boolean;
  placement?: "start" | "end";
  tone?: ModalFooterActionTone;
  title?: string;
  "data-phase"?: string;
};

type ModalShellProps = {
  open: boolean;
  children: ReactNode;
  footer?: ReactNode;
  footerMeta?: ReactNode;
  footerActions?: ModalFooterAction[];
  onClose?: () => void;
  onRequestClose?: (reason: ModalCloseReason) => void;
  panelClassName?: string;
  viewportClassName?: string;
  contentClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
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

function getFooterActionToneClassName(tone: ModalFooterActionTone) {
  if (tone === "primary") {
    return "bg-action-primary-bg text-action-primary-text hover:bg-action-primary-hover disabled:bg-action-primary-disabled";
  }
  if (tone === "danger") {
    return "border border-status-error-border text-status-error-text hover:bg-status-error-bg";
  }
  if (tone === "ghost") {
    return "text-text-subtle hover:bg-surface-subtle hover:text-text-default";
  }
  return "border border-border-default text-text-default hover:bg-surface-hover";
}

export function ModalShell({
  open,
  children,
  footer,
  footerMeta,
  footerActions,
  onClose,
  onRequestClose,
  panelClassName,
  viewportClassName,
  contentClassName,
  bodyClassName,
  footerClassName,
  backdropClassName,
  dialogClassName,
  panelRef,
  dismissable = true,
}: ModalShellProps) {
  const startActions =
    footerActions?.filter((action) => action.placement === "start") ?? [];
  const endActions =
    footerActions?.filter((action) => action.placement !== "start") ?? [];
  const hasStructuredFooter =
    Boolean(footerMeta) || startActions.length > 0 || endActions.length > 0;
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
                <div className={joinClassNames("min-h-0", bodyClassName)}>
                  {children}
                </div>
                {hasStructuredFooter ? (
                  <div
                    className={joinClassNames(
                      "flex items-center justify-between gap-3 border-t border-border-subtle px-6 py-4",
                      footerClassName,
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {footerMeta}
                      {startActions.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {startActions.map((action, index) => (
                            <ModalFooterActionButton
                              key={action.id ?? `start-${index}`}
                              action={action}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {endActions.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {endActions.map((action, index) => (
                          <ModalFooterActionButton
                            key={action.id ?? `end-${index}`}
                            action={action}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : footer ? (
                  <div
                    className={joinClassNames(
                      "flex items-center justify-end gap-2 border-t border-border-subtle px-6 py-4",
                      footerClassName,
                    )}
                  >
                    {footer}
                  </div>
                ) : null}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

function ModalFooterActionButton({ action }: { action: ModalFooterAction }) {
  return (
    <button
      type={action.type ?? "button"}
      onClick={action.onClick}
      form={action.form}
      disabled={action.disabled}
      className={joinClassNames(
        "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        getFooterActionToneClassName(action.tone ?? "secondary"),
      )}
      title={action.title}
      data-phase={action["data-phase"]}
    >
      {action.icon}
      {action.label}
    </button>
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
        "flex items-center justify-between gap-4 border-b border-border-default px-6 py-5",
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
              "text-xl font-semibold text-text-default",
              titleClassName,
            )}
          >
            {title}
          </DialogTitle>
        </div>
        {description ? (
          <p
            className={joinClassNames(
              "mt-1 text-sm leading-6 text-text-muted",
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
