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
              icon={
                <GitBranch className="h-6 w-6 text-blue-500" aria-hidden />
              }
              actions={
                <>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="border border-slate-300 px-4 py-2 font-semibold text-slate-500 hover:text-slate-800"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 bg-blue-500 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
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
                <span className="font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder={placeholder}
                  className="w-full border border-slate-300 bg-slate-50 px-3 py-2 text-slate-800 outline-none transition-colors focus:border-blue-500"
                />
              </label>
              {error ? (
                <p className="mt-2 text-rose-700">{error}</p>
              ) : null}
            </DialogCard>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
