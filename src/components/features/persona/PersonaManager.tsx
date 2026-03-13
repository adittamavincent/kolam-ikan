import { Fragment, useState } from "react";
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
  const { personas, isLoading } = usePersonas({ includeDeleted: true });
  const { createPersona, updatePersona, deletePersona, hardDeletePersona } =
    usePersonaMutations();

  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<Persona | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPreparingDelete, setIsPreparingDelete] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deleteUsageCount, setDeleteUsageCount] = useState(0);
  const [transferPersonaId, setTransferPersonaId] = useState("");
  const [isPermanent, setIsPermanent] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("user");
  const [color, setColor] = useState("#0ea5e9");
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    try {
      if (editingPersona) {
        await updatePersona.mutateAsync({
          id: editingPersona.id,
          updates: { name, icon, color },
        });
        setEditingPersona(null);
      } else {
        await createPersona.mutateAsync({
          name,
          icon,
          color,
          type: "HUMAN",
        });
        setIsCreating(false);
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    }
  };

  const transferCandidates = (personas ?? [])
    .filter((persona) => !persona.deleted_at)
    .filter((persona) => persona.id !== deletingPersona?.id);

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

  return (
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
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-2xl transform overflow-hidden rounded-xl bg-surface-default p-6 text-left align-middle transition-all border border-border-default">
                <div className="flex items-center justify-between mb-6">
                  <DialogTitle
                    as="h3"
                    className="text-lg font-medium leading-6 text-text-default"
                  >
                    Manage Personas
                  </DialogTitle>
                  <button
                    onClick={onClose}
                    className="rounded-xl p-1 hover:bg-surface-subtle transition-colors text-text-muted hover:text-text-default"
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

                    <div className="rounded-sm border border-border-subtle bg-surface-subtle p-3">
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
                          className="w-full rounded-sm border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
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
                      <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 rounded-sm">
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
                        className="px-4 py-2 text-sm font-medium text-text-subtle hover:text-text-default hover:bg-surface-subtle rounded-sm transition-colors"
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
                          className="px-4 py-2 text-sm font-medium bg-status-error-bg text-status-error-text hover:opacity-90 rounded-sm transition-colors disabled:opacity-50 flex items-center gap-2"
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
                              className="px-4 py-2 text-sm font-medium border border-status-error-text/30 text-status-error-text hover:bg-status-error-bg/10 rounded-sm transition-colors disabled:opacity-50 flex items-center gap-2"
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
                            className="px-4 py-2 text-sm font-medium bg-status-error-bg text-status-error-text hover:opacity-90 rounded-sm transition-colors disabled:opacity-50 flex items-center gap-2"
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
                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-sm border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                        placeholder="e.g., Creative Mode"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">
                        Color
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            className={`w-8 h-8 rounded-xl border-2 transition-transform hover:scale-110 ${color === c ? "border-text-default" : "border-transparent"}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-subtle mb-1">
                        Icon
                      </label>
                      <div className="grid grid-cols-6 gap-2">
                        {PRESET_ICONS.map((ic) => (
                          <button
                            key={ic}
                            type="button"
                            onClick={() => setIcon(ic)}
                            className={`flex items-center justify-center p-2 rounded-sm border transition-colors ${icon === ic ? "bg-action-primary-bg/10 border-action-primary-bg text-action-primary-bg" : "border-border-subtle hover:bg-surface-subtle text-text-subtle"}`}
                          >
                            <DynamicIcon name={ic} className="h-5 w-5" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 rounded-sm">
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
                        }}
                        className="px-4 py-2 text-sm font-medium text-text-subtle hover:text-text-default hover:bg-surface-subtle rounded-sm transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={
                          createPersona.isPending || updatePersona.isPending
                        }
                        className="px-4 py-2 text-sm font-medium bg-action-primary-bg text-white hover:bg-action-primary-hover rounded-sm transition-colors disabled:opacity-50 flex items-center gap-2"
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
                    <div className="flex items-center justify-between mb-4">
                      <button
                        onClick={() => {
                          setIsCreating(true);
                          setName("");
                          setIcon("user");
                          setColor("#0ea5e9");
                          setError(null);
                        }}
                        className="flex items-center gap-2 rounded-sm bg-action-primary-bg px-3 py-1.5 text-xs font-medium text-action-primary-text hover:bg-action-primary-hover transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                        New Persona
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
                    {error && (
                      <div className="mb-3 flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg/10 p-2 rounded-sm">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                      </div>
                    )}
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                      {isLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                        </div>
                      ) : (
                        personas
                          ?.filter((persona) =>
                            showDeleted ? true : !persona.deleted_at,
                          )
                          .map((persona) => (
                            <div
                              key={persona.id}
                              className={`flex items-center justify-between p-3 rounded-xl border border-border-subtle bg-surface-default hover:border-border-default transition-colors ${persona.deleted_at ? "opacity-60" : ""}`}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="h-10 w-10 rounded-sm flex items-center justify-center"
                                  style={{
                                    backgroundColor: `${persona.color}20`,
                                    color: persona.color,
                                  }}
                                >
                                  <DynamicIcon
                                    name={persona.icon}
                                    className="h-5 w-5"
                                  />
                                </div>
                                <div>
                                  <h4 className="font-medium text-text-default flex items-center gap-2">
                                    {persona.name}
                                    {persona.is_system && (
                                      <span className="text-[10px] bg-surface-subtle text-text-muted px-1.5 py-0.5 rounded-sm border border-border-subtle uppercase tracking-wider">
                                        System
                                      </span>
                                    )}
                                    {persona.deleted_at && (
                                      <span className="text-[10px] bg-status-error-bg/20 text-status-error-text px-1.5 py-0.5 rounded-sm border border-status-error-text/20 uppercase tracking-wider">
                                        Deleted
                                      </span>
                                    )}
                                  </h4>
                                  <p className="text-xs text-text-muted capitalize">
                                    {persona.type.toLowerCase()}
                                  </p>
                                </div>
                              </div>

                              {!persona.is_system &&
                                persona.user_id === user?.id &&
                                persona.type === "HUMAN" && (
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
                                          className="px-2 py-1 text-xs text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-sm transition-colors"
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
                                          className="px-2 py-1 text-xs text-status-error-text hover:bg-status-error-bg/10 rounded-sm transition-colors"
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
                                          onClick={() => {
                                            setEditingPersona(persona);
                                            setDeletingPersona(null);
                                            setName(persona.name);
                                            setIcon(persona.icon);
                                            setColor(persona.color);
                                            setError(null);
                                          }}
                                          className="p-2 text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-sm transition-colors"
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
                                          className="p-2 text-text-muted hover:text-status-error-text hover:bg-status-error-bg/10 rounded-sm transition-colors"
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
                          ))
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
  );
}
