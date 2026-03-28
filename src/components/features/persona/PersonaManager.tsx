import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { X, Plus, Pencil, Trash2, Loader2, AlertCircle } from "lucide-react";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { usePersonaMutations } from "@/lib/hooks/usePersonaMutations";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { Persona } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  DEFAULT_PERSONA_TYPE,
  getPersonaScopeDescription,
  getPersonaScopeLabel,
  getPersonaTintStyle,
  getPersonaTypeLabel,
  sanitizePersonaTypeInput,
} from "@/lib/personas";

function isLocalPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Failed to save persona";
};

interface PersonaManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_ICONS = [
  "user",
  "brain",
  "cloud-rain",
  "heart",
  "coffee",
  "code",
  "zap",
  "feather",
  "target",
  "shield",
  "star",
  "smile",
];

const PRESET_COLORS = [
  "#0ea5e9", // Sky
  "#64748b", // Slate
  "#8b5cf6", // Violet
  "#ef4444", // Red
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#ec4899", // Pink
  "#6366f1", // Indigo
];

export function PersonaManager({ isOpen, onClose }: PersonaManagerProps) {
  const supabase = createClient();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { personas, isLoading } = usePersonas({ includeDeleted: true, includeLocal: true });
  const { createPersona, updatePersona, deletePersona, hardDeletePersona } =
    usePersonaMutations();

  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<Persona | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPreparingDelete, setIsPreparingDelete] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [deleteUsageCount, setDeleteUsageCount] = useState(0);
  const [transferPersonaId, setTransferPersonaId] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState(DEFAULT_PERSONA_TYPE);
  const [icon, setIcon] = useState("user");
  const [color, setColor] = useState("#0ea5e9");
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setType(DEFAULT_PERSONA_TYPE);
    setIcon("user");
    setColor("#0ea5e9");
    setError(null);
  };

  const beginCreate = () => {
    setEditingPersona(null);
    setDeletingPersona(null);
    resetForm();
    setIsCreating(true);
  };

  const beginEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setDeletingPersona(null);
    setIsCreating(false);
    setName(persona.name);
    setType(getPersonaTypeLabel(persona.type));
    setIcon(persona.icon);
    setColor(persona.color);
    setError(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Title is required");
      return;
    }

    if (!type.trim()) {
      setError("Type is required");
      return;
    }

    const normalizedType = sanitizePersonaTypeInput(type);

    try {
      if (editingPersona) {
        await updatePersona.mutateAsync({
          id: editingPersona.id,
          updates: { name: name.trim(), type: normalizedType, icon, color },
        });
        setEditingPersona(null);
      } else {
        await createPersona.mutateAsync({
          name: name.trim(),
          icon,
          color,
          type: normalizedType,
        });
        setIsCreating(false);
      }
      resetForm();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  };

  const transferCandidates = (personas ?? [])
    .filter((persona) => !persona.deleted_at)
    .filter((persona) => persona.id !== deletingPersona?.id);

  const visiblePersonas = (personas ?? []).filter((persona) =>
    showDeleted ? true : !persona.deleted_at,
  );

  const selectableVisiblePersonas = visiblePersonas.filter(
    (persona) =>
      !persona.deleted_at &&
      !persona.is_system &&
      persona.user_id === user?.id,
  );

  const allVisibleSelected =
    selectableVisiblePersonas.length > 0 &&
    selectableVisiblePersonas.every((persona) =>
      selectedPersonaIds.includes(persona.id),
    );

  const togglePersonaSelection = (personaId: string) => {
    setSelectedPersonaIds((prev) =>
      prev.includes(personaId)
        ? prev.filter((id) => id !== personaId)
        : [...prev, personaId],
    );
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedPersonaIds([]);
      return;
    }
    setSelectedPersonaIds(
      selectableVisiblePersonas.map((persona) => persona.id),
    );
  };

  const requestBulkDelete = () => {
    if (selectedPersonaIds.length === 0) return;
    setIsBulkDeleteDialogOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedPersonaIds.length === 0) return;

    setIsBulkDeleteDialogOpen(false);
    setIsBulkDeleting(true);
    setError(null);

    const failedNames: string[] = [];
    for (const personaId of selectedPersonaIds) {
      const persona = personas?.find((item) => item.id === personaId);
      if (!persona) continue;
      try {
        await deletePersona.mutateAsync({ id: personaId });
      } catch {
        failedNames.push(persona.name);
      }
    }

    // Ensure all persona query variants are invalidated after bulk delete.
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
    });

    setIsBulkDeleting(false);
    if (failedNames.length > 0) {
      setError(
        `Failed to delete ${failedNames.length} persona${failedNames.length === 1 ? "" : "s"}: ${failedNames.join(", ")}`,
      );
      setSelectedPersonaIds(
        selectedPersonaIds.filter((id) => {
          const persona = personas?.find((item) => item.id === id);
          return !!persona && failedNames.includes(persona.name);
        }),
      );
      return;
    }

    setSelectedPersonaIds([]);
    setIsBulkMode(false);
  };

  const bulkDeleteCount = selectedPersonaIds.length;
  const bulkDeleteTitle=`Delete ${bulkDeleteCount} selected persona${
 bulkDeleteCount === 1 ? "" : "s"
 }?`;
  const bulkDeleteDescription =
    "Personas that are in use may fail and will be reported.";

  const handleDeleteRequest = async (persona: Persona) => {
    setError(null);
    setIsPreparingDelete(true);

    try {
      const { data: usageRows, error: usageError } = await supabase
        .from("sections")
        .select(
          "id, entries(id, is_draft, deleted_at, streams(id, deleted_at, domains(id, deleted_at)))",
        )
        .eq("persona_id", persona.id);

      if (usageError) throw usageError;

      const activeUsageCount = (usageRows ?? []).filter((row) => {
        const entry = Array.isArray(row.entries) ? row.entries[0] : row.entries;
        if (!entry) return false;

        const streamRaw = (entry as { streams?: unknown }).streams;
        const stream = Array.isArray(streamRaw) ? streamRaw[0] : streamRaw;
        if (!stream) return false;

        const domainRaw = (stream as { domains?: unknown }).domains;
        const domain = Array.isArray(domainRaw) ? domainRaw[0] : domainRaw;
        if (!domain) return false;

        return (
          entry.is_draft === false &&
          entry.deleted_at == null &&
          (stream as { deleted_at?: string | null }).deleted_at == null &&
          (domain as { deleted_at?: string | null }).deleted_at == null
        );
      }).length;

      const nextTransferCandidates = (personas ?? [])
        .filter((candidate) => !candidate.deleted_at)
        .filter((candidate) => candidate.id !== persona.id);

      setDeletingPersona(persona);
      setDeleteUsageCount(activeUsageCount);
      setTransferPersonaId(nextTransferCandidates[0]?.id ?? "");
      setIsPermanent(!!persona.deleted_at);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsPreparingDelete(false);
    }
  };

  const handleDelete = async (permanent?: boolean) => {
    if (!deletingPersona) return;
    const usePermanent = permanent ?? isPermanent;

    if (deleteUsageCount > 0 && !transferPersonaId) {
      setError(
        "Select a transfer target to migrate used sections before deleting.",
      );
      return;
    }

    try {
      const transferPersona = transferCandidates.find(
        (candidate) => candidate.id === transferPersonaId,
      );
      const params = {
        id: deletingPersona.id,
        transferToId: deleteUsageCount > 0 ? transferPersonaId : undefined,
        transferToName:
          deleteUsageCount > 0 ? (transferPersona?.name ?? null) : undefined,
      };

      if (usePermanent) {
        await hardDeletePersona.mutateAsync(params);
      } else {
        await deletePersona.mutateAsync(params);
      }

      setDeletingPersona(null);
      setDeleteUsageCount(0);
      setTransferPersonaId("");
      setIsPermanent(false);
      setError(null);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    }
  };

  const previewScopeSource = editingPersona
    ? editingPersona
    : { is_shadow: false as const };
  const previewTypeLabel = sanitizePersonaTypeInput(type, DEFAULT_PERSONA_TYPE);
  const canEditPersona = (persona: Persona) =>
    !persona.is_system && persona.user_id === user?.id;

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={onClose}>
          <TransitionChild
            as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0"
            >
              <DialogPanel className="w-full max-w-xl transform overflow-hidden bg-surface-default p-4 text-left align-middle transition-all border border-border-default">
                <div className="flex items-center justify-between mb-4">
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-text-default"
                  >
                    Manage Personas
                  </DialogTitle>
                  <button
                    onClick={onClose}
                    className=" p-1 hover:bg-surface-subtle transition-colors text-text-muted hover:text-text-default"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {deletingPersona ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium text-text-default">
                        {isPermanent
                          ? "Permanently Delete Persona"
                          : "Delete Persona"}
                      </h4>
                      <p className="mt-1 text-xs text-text-muted">
                        You are deleting{" "}
                        <span className="font-medium text-text-default">
                          {deletingPersona.name}
                        </span>
                        .
                        {isPermanent && (
                          <span className="text-status-error-text">
                            {" "}
                            This action cannot be undone.
                          </span>
                        )}
                      </p>
                    </div>

                    <div className=" border border-border-default bg-surface-subtle p-3">
                      <p className="text-xs text-text-subtle">
                        {deleteUsageCount === 0 ? (
                          <span>
                            This persona is{" "}
                            <span className="font-semibold text-text-default">
                              not used
                            </span>{" "}
                            in any active sections.
                          </span>
                        ) : (
                          <span>
                            This persona is currently used in{" "}
                            <span className="font-semibold text-text-default">
                              {deleteUsageCount}
                            </span>{" "}
                            active section{deleteUsageCount === 1 ? "" : "s"}.
                          </span>
                        )}
                      </p>
                    </div>

                    {deleteUsageCount > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-text-subtle mb-1">
                          Transfer sections to
                        </label>
                        <select
                          value={transferPersonaId}
                          onChange={(e) => setTransferPersonaId(e.target.value)}
                          className="w-full border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-border-default focus: focus: focus:"
                        >
                          <option value="">Select persona</option>
                          {transferCandidates.map((persona) => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                        {transferCandidates.length === 0 && (
                          <p className="mt-2 text-xs text-status-error-text">
                            Create another active persona first, then retry
                            deletion.
                          </p>
                        )}
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 ">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 mt-6">
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingPersona(null);
                          setDeleteUsageCount(0);
                          setTransferPersonaId("");
                          setIsPermanent(false);
                          setError(null);
                        }}
                        className="px-4 py-2 text-sm font-medium text-text-subtle hover:text-text-default hover:bg-surface-subtle transition-colors"
                      >
                        Cancel
                      </button>
                      {isPermanent ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(true)}
                          disabled={
                            hardDeletePersona.isPending ||
                            (deleteUsageCount > 0 &&
                              transferCandidates.length === 0)
                          }
                          className="px-4 py-2 text-sm font-medium bg-status-error-bg text-status-error-text hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {hardDeletePersona.isPending && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          Delete Permanently
                        </button>
                      ) : (
                        <>
                          {deleteUsageCount === 0 && (
                            <button
                              type="button"
                              onClick={() => handleDelete(true)}
                              disabled={hardDeletePersona.isPending}
                              className="px-4 py-2 text-sm font-medium border border-status-error-text/30 text-status-error-text hover:bg-status-error-bg/10 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                              {hardDeletePersona.isPending && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                              Delete Permanently
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(false)}
                            disabled={
                              deletePersona.isPending ||
                              (deleteUsageCount > 0 &&
                                transferCandidates.length === 0)
                            }
                            className="px-4 py-2 text-sm font-medium bg-status-error-bg text-status-error-text hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            {deletePersona.isPending && (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {deleteUsageCount > 0
                              ? "Delete & Transfer"
                              : "Soft Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : isCreating || editingPersona ? (
                  <form onSubmit={handleSave} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-text-subtle">
                            Title
                          </label>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-border-default focus: focus: focus:"
                            placeholder="e.g., Creative Mode"
                            maxLength={60}
                            autoFocus
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-text-subtle">
                            Type
                          </label>
                          <input
                            type="text"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            className="w-full border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-border-default focus: focus: focus:"
                            placeholder="e.g., Mentor, Critic, Strategist"
                            maxLength={40}
                          />
                          <p className="mt-1 text-[11px] text-text-muted">
                            A flexible label that helps you distinguish the role this persona plays.
                          </p>
                        </div>

                        <div className="border border-border-default bg-surface-subtle/40 p-3">
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                            Scope
                          </div>
                          <div className="text-sm text-text-default">
                            {getPersonaScopeLabel(previewScopeSource)}
                          </div>
                          <div className="mt-1 text-[11px] text-text-muted">
                            {getPersonaScopeDescription(previewScopeSource)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div
                          className="border p-3"
                          style={getPersonaTintStyle(
                            {
                              color,
                              is_shadow: previewScopeSource.is_shadow,
                              type: previewTypeLabel,
                            },
                            {
                              backgroundAlpha: previewScopeSource.is_shadow ? 0.14 : 0.08,
                              borderAlpha: 0.24,
                            },
                          )}
                        >
                          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                            Preview
                          </div>
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 items-center justify-center"
                              style={{ backgroundColor: `${color}20`, color }}
                            >
                              <DynamicIcon name={icon} className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-text-default">
                                {name.trim() || "Untitled Persona"}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="border border-border-default bg-surface-default/70 px-1.5 py-0.5 text-text-muted">
                                  {previewTypeLabel}
                                </span>
                                <span className="border border-border-default bg-surface-default/70 px-1.5 py-0.5 text-text-muted">
                                  {getPersonaScopeLabel(previewScopeSource)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-text-subtle">
                            Color
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setColor(c)}
                                className={`h-8 w-8 border-2 transition-transform hover:scale-110 ${color === c ? "border-text-default" : "border-transparent"}`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-text-subtle">
                            Icon
                          </label>
                          <div className="grid grid-cols-6 gap-2">
                            {PRESET_ICONS.map((ic) => (
                              <button
                                key={ic}
                                type="button"
                                onClick={() => setIcon(ic)}
                                className={`flex items-center justify-center border p-2 transition-colors ${icon === ic ? "bg-action-primary-bg/10 border-border-default text-action-primary-bg" : "border-border-default hover:bg-surface-subtle text-text-subtle"}`}
                              >
                                <DynamicIcon name={ic} className="h-5 w-5" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 ">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 mt-6">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreating(false);
                          setEditingPersona(null);
                          resetForm();
                        }}
                        className="px-4 py-2 text-sm font-medium text-text-subtle hover:text-text-default hover:bg-surface-subtle transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={
                          createPersona.isPending || updatePersona.isPending
                        }
                        className="px-4 py-2 text-sm font-medium bg-action-primary-bg text-white hover:bg-action-primary-hover transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {(createPersona.isPending ||
                          updatePersona.isPending) && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        Save Persona
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={beginCreate}
                        className="flex items-center gap-2 bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:bg-action-primary-hover transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                        New Persona
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsBulkMode((prev) => !prev);
                            setSelectedPersonaIds([]);
                          }}
                          className={` px-2 py-1 text-[11px] font-medium transition-colors ${
                            isBulkMode
                              ? "bg-status-error-bg/15 text-status-error-text"
                              : "bg-surface-subtle text-text-muted hover:text-text-default"
                          }`}
                        >
                          {isBulkMode ? "Exit Bulk" : "Bulk Delete"}
                        </button>
                        <label className="flex items-center gap-2 text-[11px] text-text-muted">
                          <input
                            type="checkbox"
                            checked={showDeleted}
                            onChange={() => setShowDeleted((value) => !value)}
                          />
                          Show deleted
                        </label>
                      </div>
                    </div>

                    {isBulkMode && (
                      <div className="mb-3 flex items-center justify-between gap-2 border border-border-default bg-surface-subtle/40 px-2.5 py-2 text-[11px]">
                        <div className="text-text-muted">
                          {selectedPersonaIds.length} selected
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleSelectAllVisible}
                            className=" px-2 py-1 text-text-default hover:bg-surface-subtle"
                          >
                            {allVisibleSelected ? "Clear all" : "Select all"}
                          </button>
                          <button
                            type="button"
                            onClick={requestBulkDelete}
                            disabled={
                              selectedPersonaIds.length === 0 || isBulkDeleting
                            }
                            className="inline-flex items-center gap-1 bg-status-error-bg px-2 py-1 font-medium text-status-error-text disabled:opacity-50"
                          >
                            {isBulkDeleting && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            Delete selected
                          </button>
                        </div>
                      </div>
                    )}
                    {error && (
                      <div className="mb-3 flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 ">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}
                    <div className="space-y-1.5 max-h-[65vh] overflow-y-auto pr-1">
                      {isLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                        </div>
                      ) : (
                        visiblePersonas.map((persona) => {
                          const isSelectable =
                            isBulkMode &&
                            !persona.deleted_at &&
                            !persona.is_system &&
                            persona.user_id === user?.id;

                          return (
                            <div
                              key={persona.id}
                              onClick={(e) => {
                                if (
                                  isSelectable &&
                                  !(e.target as HTMLElement).closest("button")
                                ) {
                                  togglePersonaSelection(persona.id);
                                }
                              }}
                              className={`flex items-center justify-between border border-border-default bg-surface-default p-2 transition-colors ${persona.deleted_at ? "opacity-60" : ""} ${isSelectable ? "cursor-pointer" : ""}`}
                            >
                              <div className="flex items-center gap-2">
                                {isSelectable && (
                                  <input
                                    type="checkbox"
                                    checked={selectedPersonaIds.includes(
                                      persona.id,
                                    )}
                                    readOnly
                                    className="h-4 w-4 pointer-events-none border-border-default"
                                  />
                                )}
                                <div
                                  className="flex h-8 w-8 items-center justify-center"
                                  style={{
                                    backgroundColor: `${persona.color}20`,
                                    color: persona.color,
                                  }}
                                >
                                  <DynamicIcon
                                    name={persona.icon}
                                    className="h-4 w-4"
                                  />
                                </div>
                                <div>
                                  <h4 className="flex items-center gap-1.5 text-sm font-medium text-text-default">
                                    {persona.name}
                                    {persona.is_system && (
                                      <span className="border border-border-default bg-surface-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                                        System
                                      </span>
                                    )}
                                    {isLocalPersona(persona) && (
                                      <span className="border border-border-default/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                                        Local
                                      </span>
                                    )}
                                    {persona.deleted_at && (
                                      <span className="border border-status-error-text/20 bg-status-error-bg/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-status-error-text">
                                        Deleted
                                      </span>
                                    )}
                                  </h4>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="border border-border-default bg-surface-subtle px-1.5 py-0.5 text-text-muted">
                                      {getPersonaTypeLabel(persona.type)}
                                    </span>
                                    <span className="text-text-muted">
                                      {getPersonaScopeDescription(persona)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {canEditPersona(persona) && (
                                <div className="flex items-center gap-1">
                                  {persona.deleted_at ? (
                                    <>
                                      <button
                                        onClick={async () => {
                                          await updatePersona.mutateAsync({
                                            id: persona.id,
                                            updates: { deleted_at: null },
                                          });
                                        }}
                                        className="px-2 py-1 text-xs text-text-muted hover:text-text-default hover:bg-surface-subtle transition-colors"
                                        title="Restore"
                                      >
                                        Restore
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDeleteRequest(persona)
                                        }
                                        disabled={
                                          isPreparingDelete ||
                                          hardDeletePersona.isPending
                                        }
                                        className="px-2 py-1 text-xs text-status-error-text hover:bg-status-error-bg/10 transition-colors"
                                        title="Delete permanently"
                                      >
                                        {isPreparingDelete ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          "Delete Permanently"
                                        )}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => beginEdit(persona)}
                                        className="p-2 text-text-muted hover:text-text-default hover:bg-surface-subtle transition-colors"
                                        title="Edit"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDeleteRequest(persona)
                                        }
                                        disabled={
                                          isPreparingDelete ||
                                          deletePersona.isPending
                                        }
                                        className="p-2 text-text-muted hover:text-status-error-text hover:bg-status-error-bg/10 transition-colors"
                                        title="Delete"
                                      >
                                        {isPreparingDelete ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Trash2 className="h-4 w-4" />
                                        )}
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                        );
                      })
                      )}
                    </div>
                  </>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
      <ConfirmDialog
        open={isBulkDeleteDialogOpen}
        title={bulkDeleteTitle}
        description={bulkDeleteDescription}
        confirmLabel="Delete selected"
        cancelLabel="Cancel"
        destructive
        loading={isBulkDeleting}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
        onConfirm={() => {
          void handleBulkDelete();
        }}
      />
    </>
  );
}
