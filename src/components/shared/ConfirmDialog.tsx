"use client";

import { Fragment, ReactNode, useEffect, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DialogCard } from "@/components/shared/DialogCard";

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
  hideCancel?: boolean;
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
  hideCancel = false,
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
        if (!hideCancel) onCancel();
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
  }, [open, onCancel, onConfirm, loading, hideCancel]);

  const contentIcon = icon ?? (
    <AlertTriangle className="h-6 w-6 text-rose-700" aria-hidden />
  );

  const confirmClasses = destructive
    ? "inline-flex items-center justify-center gap-2 bg-rose-100 px-4 py-2 font-semibold text-rose-700 hover:bg-rose-300 disabled:cursor-not-allowed disabled:text-slate-500"
    : "inline-flex items-center justify-center gap-2 bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200";

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={hideCancel ? () => {} : onCancel}
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
          <div className="fixed inset-0 bg-black/45" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 translate-y-2"
            enterTo="opacity-100 translate-y-0 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0 scale-100"
            leaveTo="opacity-0 translate-y-2"
          >
            <DialogCard
              title={title}
              description={description}
              icon={contentIcon}
              actions={
                <>
                  {!hideCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="border border-slate-300 px-4 py-2 font-semibold text-slate-500 hover:text-slate-800"
                    >
                      {cancelLabel}
                    </button>
                  )}
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
                </>
              }
            />
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
