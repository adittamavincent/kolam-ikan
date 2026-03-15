"use client";

import { Fragment, ReactNode, useEffect, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { AlertTriangle, Loader2 } from "lucide-react";

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  icon,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && !loading) {
        event.preventDefault();
        onConfirm();
      }
    };

    if (typeof window === "undefined") return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel, onConfirm, loading]);

  const contentIcon =
    icon ?? (
      <AlertTriangle className="h-6 w-6 text-status-error-text" aria-hidden />
    );

  const confirmClasses = destructive
    ? "inline-flex items-center justify-center gap-2  bg-status-error-bg px-4 py-2 text-sm font-semibold text-status-error-text hover:bg-status-error-bg/90 disabled:cursor-not-allowed disabled:opacity-60"
    : "inline-flex items-center justify-center gap-2  bg-action-primary-bg px-4 py-2 text-sm font-semibold text-action-primary-text hover:bg-action-primary-bg/90 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onCancel}
        aria-live="polite"
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40 backdrop-blur-xs" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 translate-y-2 scale-95"
            enterTo="opacity-100 translate-y-0 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0 scale-100"
            leaveTo="opacity-0 translate-y-2 scale-95"
          >
            <Dialog.Panel className="w-full max-w-lg  border border-border-default bg-surface-default p-6 text-left shadow-2xl">
              <div className="flex items-start gap-3">
                <div className=" border border-border-default bg-surface-subtle/80 p-2">
                  {contentIcon}
                </div>
                <div className="flex-1 space-y-1">
                  <Dialog.Title className="text-base font-semibold text-text-default">
                    {title}
                  </Dialog.Title>
                  {description && (
                    <Dialog.Description as="div" className="text-sm text-text-muted">
                      {description}
                    </Dialog.Description>
                  )}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className=" border border-border-default px-4 py-2 text-sm font-semibold text-text-muted  hover:text-text-default"
                >
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  ref={confirmButtonRef}
                  onClick={() => {
                    if (loading) return;
                    onConfirm();
                  }}
                  className={confirmClasses}
                  disabled={loading}
                >
                  {loading && (
                    <Loader2 className="h-4 w-4 animate-spin text-current" />
                  )}
                  {confirmLabel}
                </button>
              </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
