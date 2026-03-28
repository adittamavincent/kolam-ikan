"use client";

import { Fragment, ReactNode, useEffect, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { GitBranch, Loader2 } from "lucide-react";
import { DialogCard } from "@/components/shared/DialogCard";

type TextInputDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  value: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TextInputDialog({
  open,
  title,
  description,
  value,
  label = "Name",
  placeholder,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  loading = false,
  error = null,
  onChange,
  onCancel,
  onConfirm,
}: TextInputDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onCancel, onConfirm, open]);

  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onCancel}>
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
            enterFrom="opacity-0 translate-y-2"
            enterTo="opacity-100 translate-y-0 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0 scale-100"
            leaveTo="opacity-0 translate-y-2"
          >
            <DialogCard
              title={title}
              description={description}
              icon={<GitBranch className="h-6 w-6 text-action-primary-bg" aria-hidden />}
              actions={
                <>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="border border-border-default px-4 py-2 text-sm font-semibold text-text-muted hover:text-text-default"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 bg-action-primary-bg px-4 py-2 text-sm font-semibold text-action-primary-text hover:bg-action-primary-bg/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-current" />
                    ) : null}
                    {confirmLabel}
                  </button>
                </>
              }
            >
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {label}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-border-default bg-surface-subtle px-3 py-2 text-sm text-text-default outline-none transition-colors focus:border-action-primary-bg"
                />
              </label>
              {error ? (
                <p className="mt-2 text-sm text-status-error-text">{error}</p>
              ) : null}
            </DialogCard>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
