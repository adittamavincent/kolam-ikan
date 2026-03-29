import { useState, useEffect } from "react";
import { Globe, Check, Loader2, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDomains } from "@/lib/hooks/useDomains";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import {
  DEFAULT_DOMAIN_ICON,
  DOMAIN_ICON_OPTIONS,
} from "@/lib/constants/domainIcons";

interface CreateDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

/**
 * Modal for creating a new domain (workspace).
 *
 * Features:
 * - Instant creation with optimistic updates (handled by useDomains)
 * - Name validation (required, unique check)
 * - Automatic redirect to new domain
 * - Keyboard accessible
 * - Mobile responsive
 *
 * Future improvements:
 * - Analytics tracking (on success)
 * - Custom icon selection
 * - Advanced settings (e.g. description, public/private)
 */
export function CreateDomainModal({
  isOpen,
  onClose,
  userId,
}: CreateDomainModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_DOMAIN_ICON);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { createDomain, domains } = useDomains(userId);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setIcon(DEFAULT_DOMAIN_ICON);
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!name.trim()) {
      setError("Domain name cannot be empty");
      return;
    }

    // Check for duplicates (case insensitive)
    const isDuplicate = domains?.some(
      (d) => d.name.toLowerCase() === name.trim().toLowerCase(),
    );

    if (isDuplicate) {
      setError("A domain with this name already exists");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Create domain with default icon and settings
      const newDomain = await createDomain.mutateAsync({
        name: name.trim(),
        user_id: userId,
        icon,
        settings: { root_restriction: "mixed" }, // Default settings
        sort_order: (domains?.length || 0) + 1,
      });

      // Redirect to new domain
      router.push(`/${newDomain.id}`);
      onClose();
    } catch (err) {
      console.error("Failed to create domain:", err);
      setError("Failed to create domain. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      panelClassName="w-full"
      footerActions={[
        {
          label: "Cancel",
          onClick: onClose,
          disabled: isSubmitting,
          tone: "ghost",
        },
        {
          label: isSubmitting ? "Creating..." : "Create Domain",
          icon: isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          ),
          type: "submit",
          form: "create-domain-form",
          disabled: !name.trim() || isSubmitting,
          tone: "primary",
        },
      ]}
    >
      <ModalHeader
        title="Create New Domain"
        description="Create a new workspace for your content."
        icon={<Globe className="h-5 w-5" />}
        onClose={onClose}
      />

      <form id="create-domain-form" onSubmit={handleSubmit} className="px-6 py-5">
        <div className="mt-2">
          <div className="relative">
            <input
              type="text"
              className={`block w-full  border px-4 py-3 text-text-default placeholder-text-muted focus: focus: transition-all ${
                error
                  ? "border-status-error-text focus:border-status-error-text focus:"
                  : "border-border-default focus:border-border-default focus:"
              }`}
              placeholder="e.g., My Knowledge Base"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
          </div>

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
            <div className="mt-3 flex items-center gap-2 text-sm text-status-error-text animate-fade-in">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

      </form>
    </ModalShell>
  );
}
