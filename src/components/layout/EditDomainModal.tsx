import { useState } from "react";
import { Check, AlertCircle, Loader2, Pencil, Trash2 } from "lucide-react";
import { useDomains } from "@/lib/hooks/useDomains";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import {
  DEFAULT_DOMAIN_ICON,
  DOMAIN_ICON_OPTIONS,
} from "@/lib/constants/domainIcons";
import { Domain } from "@/lib/types";

function getDomainDuplicateErrorMessage(error: unknown) {
  const maybeError = error as {
    code?: string;
    message?: string;
    details?: string | null;
  } | null;
  if (
    maybeError?.code === "23505" &&
    maybeError?.message?.includes("idx_unique_active_domain_name")
  ) {
    return "A domain with this name already exists.";
  }
  if (
    maybeError?.code === "23505" &&
    maybeError?.message?.includes("unique_canvas_per_stream")
  ) {
    return "Domain duplication hit a canvas conflict. Please retry after refreshing.";
  }
  if (
    maybeError?.code === "23505" &&
    maybeError?.message?.includes("duplicate key value")
  ) {
    return "A domain with this name already exists.";
  }
  if (maybeError?.message) {
    return maybeError.message;
  }
  return "Failed to duplicate domain. Please try again.";
}

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
  const { updateDomain, deleteDomain, duplicateDomain, domains } =
    useDomains(userId);
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

  const isMutating =
    updateDomain.isPending ||
    deleteDomain.isPending ||
    duplicateDomain.isPending;

  const handleDuplicate = async () => {
    if (!domain) return;

    const suggested = `${name} — copy`;
    const requestedName = window.prompt("Duplicate domain as", suggested);
    const newName = requestedName?.trim();
    if (!newName) return;

    const duplicate = domains?.some(
      (existingDomain) =>
        existingDomain.id !== domain.id &&
        existingDomain.name.toLowerCase() === newName.toLowerCase(),
    );

    if (duplicate) {
      setError("A domain with this name already exists");
      return;
    }

    try {
      await duplicateDomain.mutateAsync({ id: domain.id, newName });
      onClose();
    } catch (err) {
      setError(getDomainDuplicateErrorMessage(err));
    }
  };

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      panelClassName="w-full"
      footerActions={[
        {
          label: deleteDomain.isPending
            ? "Deleting..."
            : confirmDelete
              ? "Confirm Delete"
              : "Delete Domain",
          icon: deleteDomain.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          ),
          onClick: handleDelete,
          disabled: isMutating,
          tone: "danger",
          placement: "start",
        },
        {
          label: duplicateDomain.isPending ? "Duplicating..." : "Duplicate Domain",
          icon: duplicateDomain.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : undefined,
          onClick: handleDuplicate,
          disabled: isMutating,
          tone: "secondary",
          placement: "start",
        },
        {
          label: "Cancel",
          onClick: onClose,
          disabled: isMutating,
          tone: "ghost",
        },
        {
          label: updateDomain.isPending ? "Saving..." : "Save Changes",
          icon: updateDomain.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          ),
          type: "submit",
          form: "edit-domain-form",
          disabled: !name.trim() || isMutating,
          tone: "primary",
        },
      ]}
    >
      <ModalHeader
        title="Edit Domain"
        description="Update your domain name and icon."
        icon={<Pencil className="h-5 w-5" />}
        onClose={onClose}
        closeDisabled={isMutating}
      />

      <form id="edit-domain-form" onSubmit={handleSubmit} className="px-6 py-5">
        <div className="mt-2">
          <input
            type="text"
            className={`block w-full  border px-4 py-3 text-text-default placeholder-text-muted transition-all focus: focus: ${
              error
                ? "border-status-error-text focus:border-status-error-text focus:"
                : "border-border-default focus:border-border-default focus:"
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
                  className={`flex items-center justify-center  border p-2 transition-colors ${
                    icon === option
                      ? "border-border-default bg-primary-950 text-action-primary-bg"
                      : "border-border-default text-text-muted hover:bg-surface-subtle hover:text-text-default"
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

      </form>
    </ModalShell>
  );
}
