import { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Check, AlertCircle, Loader2, Pencil, X, Trash2 } from "lucide-react";
import { useDomains } from "@/lib/hooks/useDomains";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import {
  DEFAULT_DOMAIN_ICON,
  DOMAIN_ICON_OPTIONS,
} from "@/lib/constants/domainIcons";
import { Domain } from "@/lib/types";

interface EditDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  domain: Domain | null;
  onDeleteSuccess?: (deletedDomainId: string) => void;
}

export function EditDomainModal({
  isOpen,
  onClose,
  userId,
  domain,
  onDeleteSuccess,
}: EditDomainModalProps) {
  const { updateDomain, deleteDomain, domains } = useDomains(userId);
  const [name, setName] = useState(domain?.name ?? "");
  const [icon, setIcon] = useState(domain?.icon || DEFAULT_DOMAIN_ICON);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (!domain) return;

    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Domain name cannot be empty");
      return;
    }

    const duplicate = domains?.some(
      (existingDomain) =>
        existingDomain.id !== domain.id &&
        existingDomain.name.toLowerCase() === normalizedName.toLowerCase(),
    );

    if (duplicate) {
      setError("A domain with this name already exists");
      return;
    }

    setError(null);

    try {
      await updateDomain.mutateAsync({
        id: domain.id,
        updates: {
          name: normalizedName,
          icon,
        },
      });
      onClose();
    } catch {
      setError("Failed to update domain. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!domain) return;

    if (!confirmDelete) {
      setError(null);
      setConfirmDelete(true);
      return;
    }

    try {
      await deleteDomain.mutateAsync(domain.id);
      onDeleteSuccess?.(domain.id);
      onClose();
    } catch {
      setError("Failed to delete domain. Please try again.");
    }
  };

  const isMutating = updateDomain.isPending || deleteDomain.isPending;

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-xl border border-border-subtle bg-surface-default p-6 text-left align-middle transition-all">
                <div className="mb-4 flex items-center justify-between">
                  <Dialog.Title
                    as="h3"
                    className="flex items-center gap-2 text-lg font-medium leading-6 text-text-default"
                  >
                    <Pencil className="h-5 w-5 text-action-primary-bg" />
                    Edit Domain
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="rounded-xl p-1 transition-colors hover:bg-surface-subtle"
                    disabled={isMutating}
                  >
                    <X className="h-5 w-5 text-text-muted" />
                  </button>
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="mt-2">
                    <p className="mb-4 text-sm text-text-muted">
                      Update your domain name and icon.
                    </p>

                    <input
                      type="text"
                      className={`block w-full rounded-sm border px-4 py-3 text-text-default placeholder-text-muted transition-all focus:outline-none focus:ring-2 ${
                        error
                          ? "border-status-error-text focus:border-status-error-text focus:ring-status-error-bg"
                          : "border-border-default focus:border-action-primary-bg focus:ring-action-primary-bg/20"
                      }`}
                      placeholder="e.g., My Knowledge Base"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        if (error) setError(null);
                      }}
                      autoFocus
                    />

                    <div className="mt-4">
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-text-muted">
                        Icon
                      </label>
                      <div className="grid grid-cols-6 gap-2">
                        {DOMAIN_ICON_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setIcon(option)}
                            className={`flex items-center justify-center rounded-sm border p-2 transition-colors ${
                              icon === option
                                ? "border-action-primary-bg bg-action-primary-bg/10 text-action-primary-bg"
                                : "border-border-subtle text-text-muted hover:bg-surface-subtle hover:text-text-default"
                            }`}
                            aria-label={`Select ${option} icon`}
                          >
                            <DynamicIcon name={option} className="h-4 w-4" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {error && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-status-error-text">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isMutating}
                      className="inline-flex items-center justify-center gap-2 rounded-sm border border-status-error-text/40 px-4 py-2 text-sm font-medium text-status-error-text transition-colors hover:bg-status-error-bg/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-error-text focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:mr-auto"
                    >
                      {deleteDomain.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" />
                          {confirmDelete ? "Confirm Delete" : "Delete Domain"}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-sm border border-transparent px-4 py-2 text-sm font-medium text-text-subtle transition-colors hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-text-muted focus-visible:ring-offset-2"
                      onClick={onClose}
                      disabled={isMutating}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!name.trim() || isMutating}
                      className="inline-flex items-center justify-center gap-2 rounded-sm border border-transparent bg-action-primary-bg px-4 py-2 text-sm font-medium text-action-primary-text transition-all hover:bg-action-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateDomain.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
