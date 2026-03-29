import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Users,
} from "lucide-react";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { usePersonaMutations } from "@/lib/hooks/usePersonaMutations";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { Persona } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  ModalFooterAction,
  ModalHeader,
  ModalShell,
} from "@/components/shared/ModalShell";
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

function PersonaIconTile({
  icon,
  color,
  className,
  iconClassName,
  syncWidthToHeight = false,
}: {
  icon: string;
  color: string;
  className: string;
  iconClassName: string;
  syncWidthToHeight?: boolean;
}) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [squareWidth, setSquareWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!syncWidthToHeight) return;

    const node = tileRef.current;
    if (!node) return;

    const updateWidth = () => {
      const nextWidth = Math.round(node.offsetHeight);
      if (nextWidth > 0) {
        setSquareWidth((current) =>
          current === nextWidth ? current : nextWidth,
        );
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [syncWidthToHeight]);

  return (
    <div
      ref={tileRef}
      className={className}
      style={{
        backgroundColor: `${color}20`,
        color,
        ...(syncWidthToHeight && squareWidth
          ? { width: `${squareWidth}px` }
          : null),
      }}
    >
      <DynamicIcon name={icon} className={iconClassName} />
    </div>
  );
}

export function PersonaManager({ isOpen, onClose }: PersonaManagerProps) {
  const nameFieldHintId = useId();
  const supabase = createClient();
  const { user } = useAuth();
  const { personas, isLoading } = usePersonas({
    includeDeleted: true,
    includeLocal: true,
  });
  const { createPersona, updatePersona, deletePersona, hardDeletePersona } =
    usePersonaMutations();

  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<Persona | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPreparingDelete, setIsPreparingDelete] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [bulkDeleteQueue, setBulkDeleteQueue] = useState<string[]>([]);
  const [bulkDeleteTotalCount, setBulkDeleteTotalCount] = useState(0);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isPreparingBulkDelete, setIsPreparingBulkDelete] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteInUseCount, setBulkDeleteInUseCount] = useState(0);
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
      !persona.deleted_at && !persona.is_system && persona.user_id === user?.id,
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

  const resetDeleteState = () => {
    setDeletingPersona(null);
    setDeleteUsageCount(0);
    setTransferPersonaId("");
    setIsPermanent(false);
    setError(null);
  };

  const getActiveUsageCount = async (personaId: string) => {
    const { data: usageRows, error: usageError } = await supabase
      .from("sections")
      .select(
        "id, entries(id, is_draft, deleted_at, streams(id, deleted_at, domains(id, deleted_at)))",
      )
      .eq("persona_id", personaId);

    if (usageError) throw usageError;

    return (usageRows ?? []).filter((row) => {
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
  };

  const openDeleteGuard = async (persona: Persona) => {
    setError(null);
    setIsPreparingDelete(true);

    try {
      const activeUsageCount = await getActiveUsageCount(persona.id);
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

  const finishBulkDeleteFlow = () => {
    setBulkDeleteQueue([]);
    setBulkDeleteTotalCount(0);
    setBulkDeleteInUseCount(0);
    setIsBulkDeleting(false);
    setSelectedPersonaIds([]);
    setIsBulkMode(false);
  };

  const continueBulkDeleteFlow = async (
    currentQueue: string[],
    processedPersonaId?: string,
  ) => {
    if (processedPersonaId) {
      setSelectedPersonaIds((prev) =>
        prev.filter((id) => id !== processedPersonaId),
      );
    }

    const remainingQueue = processedPersonaId
      ? currentQueue.filter((id) => id !== processedPersonaId)
      : currentQueue;

    if (remainingQueue.length === 0) {
      finishBulkDeleteFlow();
      return;
    }

    setBulkDeleteQueue(remainingQueue);

    const nextPersona = (personas ?? []).find(
      (persona) => persona.id === remainingQueue[0],
    );

    if (!nextPersona) {
      await continueBulkDeleteFlow(remainingQueue, remainingQueue[0]);
      return;
    }

    await openDeleteGuard(nextPersona);
  };

  const requestBulkDelete = async () => {
    if (selectedPersonaIds.length === 0) return;

    setError(null);
    setIsPreparingBulkDelete(true);

    try {
      const usageCounts = await Promise.all(
        selectedPersonaIds.map((personaId) => getActiveUsageCount(personaId)),
      );
      setBulkDeleteInUseCount(usageCounts.filter((count) => count > 0).length);
      setIsBulkDeleteDialogOpen(true);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsPreparingBulkDelete(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPersonaIds.length === 0) return;

    setIsBulkDeleteDialogOpen(false);
    setIsBulkDeleting(true);
    setError(null);
    setBulkDeleteTotalCount(selectedPersonaIds.length);
    setBulkDeleteQueue(selectedPersonaIds);
    await continueBulkDeleteFlow(selectedPersonaIds);
  };

  const bulkDeleteCount = selectedPersonaIds.length;
  const bulkDeleteTitle = `Review ${bulkDeleteCount} selected persona${
    bulkDeleteCount === 1 ? "" : "s"
  }?`;
  const bulkDeleteDescription =
    bulkDeleteInUseCount > 0
      ? `${bulkDeleteInUseCount} selected persona${
          bulkDeleteInUseCount === 1 ? " is" : "s are"
        } used in active sections. Continue to review each delete one by one with the regular guard.`
      : "Each selected persona will be reviewed one by one with the regular delete guard before anything is removed.";

  const handleDeleteRequest = async (persona: Persona) => {
    await openDeleteGuard(persona);
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

      const currentQueue = bulkDeleteQueue;
      const deletedPersonaId = deletingPersona.id;

      resetDeleteState();

      if (currentQueue.length > 0) {
        await continueBulkDeleteFlow(currentQueue, deletedPersonaId);
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    }
  };

  const previewScopeSource = editingPersona
    ? editingPersona
    : { is_shadow: false as const };
  const previewTypeLabel = sanitizePersonaTypeInput(type, DEFAULT_PERSONA_TYPE);
  const previewName = name.trim() || "Untitled Persona";
  const bulkDeleteCurrentStep =
    bulkDeleteQueue.length > 0
      ? bulkDeleteTotalCount - bulkDeleteQueue.length + 1
      : 0;
  const canEditPersona = (persona: Persona) =>
    !persona.is_system && persona.user_id === user?.id;
  const isSavingPersona = createPersona.isPending || updatePersona.isPending;
  const personaFooterActions: ModalFooterAction[] = deletingPersona
    ? [
        {
          label: bulkDeleteQueue.length > 0 ? "Skip" : "Cancel",
          onClick: () => {
            const currentQueue = bulkDeleteQueue;
            const skippedPersonaId = deletingPersona.id;

            resetDeleteState();

            if (currentQueue.length > 0) {
              void continueBulkDeleteFlow(currentQueue, skippedPersonaId);
            }
          },
          tone: "ghost",
        },
        ...(isPermanent
          ? [
              {
                label: "Delete Permanently",
                icon: hardDeletePersona.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : undefined,
                onClick: () => handleDelete(true),
                disabled:
                  hardDeletePersona.isPending ||
                  (deleteUsageCount > 0 && transferCandidates.length === 0),
                tone: "danger",
              } satisfies ModalFooterAction,
            ]
          : [
              ...(deleteUsageCount === 0
                ? [
                    {
                      label: "Delete Permanently",
                      icon: hardDeletePersona.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : undefined,
                      onClick: () => handleDelete(true),
                      disabled: hardDeletePersona.isPending,
                      tone: "danger",
                    } satisfies ModalFooterAction,
                  ]
                : []),
              {
                label:
                  deleteUsageCount > 0 ? "Delete & Transfer" : "Soft Delete",
                icon: deletePersona.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : undefined,
                onClick: () => handleDelete(false),
                disabled:
                  deletePersona.isPending ||
                  (deleteUsageCount > 0 && transferCandidates.length === 0),
                tone: "danger",
              } satisfies ModalFooterAction,
            ]),
      ]
    : isCreating || editingPersona
      ? [
          {
            label: "Cancel",
            onClick: () => {
              setIsCreating(false);
              setEditingPersona(null);
              resetForm();
            },
            tone: "ghost",
          },
          {
            label: "Save Persona",
            icon: isSavingPersona ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : undefined,
            type: "submit",
            form: "persona-editor-form",
            disabled: isSavingPersona,
            tone: "primary",
          },
        ]
      : [];

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        panelClassName="w-full"
        footerActions={personaFooterActions}
      >
        <ModalHeader
          title="Manage Personas"
          icon={<Users className="h-5 w-5" />}
          onClose={onClose}
        />

        {deletingPersona ? (
          <div className="space-y-4 px-6 py-5">
            <div>
              <h4 className="text-sm font-medium text-text-default">
                {isPermanent ? "Permanently Delete Persona" : "Delete Persona"}
              </h4>
              {bulkDeleteQueue.length > 0 && (
                <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">
                  Reviewing {bulkDeleteCurrentStep} of {bulkDeleteTotalCount}
                </p>
              )}
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
                    Create another active persona first, then retry deletion.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg p-2 ">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

          </div>
        ) : isCreating || editingPersona ? (
          <form
            id="persona-editor-form"
            onSubmit={handleSave}
            className="space-y-4 px-6 py-5"
          >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-text-subtle">
                    Title
                  </label>
                  <textarea
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="min-h-22 w-full resize-none border border-border-default bg-surface-subtle px-3 py-2 text-text-default focus:border-border-default focus: focus: focus:"
                    placeholder="e.g., Creative Mode"
                    rows={3}
                    maxLength={60}
                    autoFocus
                    aria-describedby={nameFieldHintId}
                  />
                  <div
                    id={nameFieldHintId}
                    className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-muted"
                  >
                    <span>
                      Long titles wrap here and stay compact in the preview.
                    </span>
                    <span>{name.length}/60</span>
                  </div>
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
                    A flexible label that helps you distinguish the role this
                    persona plays.
                  </p>
                </div>

                <div className="border border-border-default bg-surface-subtle p-3">
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

              <div className="min-w-0 space-y-4">
                <div
                  className="w-full min-w-0 overflow-hidden border p-3"
                  style={getPersonaTintStyle(
                    {
                      color,
                      is_shadow: previewScopeSource.is_shadow,
                      type: previewTypeLabel,
                    },
                    {
                      backgroundAlpha: previewScopeSource.is_shadow
                        ? 0.14
                        : 0.08,
                      borderAlpha: 0.24,
                    },
                  )}
                >
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                    Preview
                  </div>
                  <div className="flex min-w-0 items-start gap-3">
                    <PersonaIconTile
                      icon={icon}
                      color={color}
                      className="flex h-10 w-10 shrink-0 items-center justify-center"
                      iconClassName="h-[80%] w-[80%]"
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className="overflow-hidden text-sm font-medium leading-5 text-text-default"
                        style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          overflowWrap: "anywhere",
                        }}
                        title={previewName}
                      >
                        {previewName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="border border-border-default bg-surface-default px-1.5 py-0.5 text-text-muted">
                          {previewTypeLabel}
                        </span>
                        <span className="border border-border-default bg-surface-default px-1.5 py-0.5 text-text-muted">
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
                        className={`flex items-center justify-center border p-2 transition-colors ${icon === ic ? "bg-primary-950 border-border-default text-action-primary-bg" : "border-border-default hover:bg-surface-subtle text-text-subtle"}`}
                      >
                        <DynamicIcon name={ic} className="h-[80%] w-[80%]" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg p-2 ">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

          </form>
        ) : (
          <div className="px-6 py-5">
            <div className="mb-3 flex items-center justify-between">
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
                      ? "bg-status-error-bg text-status-error-text"
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
              <div className="mb-3 flex items-center justify-between gap-2 border border-border-default bg-surface-subtle px-2.5 py-2 text-[11px]">
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
                      selectedPersonaIds.length === 0 ||
                      isPreparingBulkDelete ||
                      isBulkDeleting
                    }
                    className="inline-flex items-center gap-1 bg-status-error-bg px-2 py-1 font-medium text-status-error-text disabled:opacity-50"
                  >
                    {(isPreparingBulkDelete || isBulkDeleting) && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Delete selected
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="mb-3 flex items-center gap-2 text-sm text-status-error-text bg-status-error-bg p-2 ">
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
                      <div className="flex items-stretch gap-2">
                        {isSelectable && (
                          <input
                            type="checkbox"
                            checked={selectedPersonaIds.includes(persona.id)}
                            readOnly
                            className="pointer-events-none h-4 w-4 self-center border-border-default"
                          />
                        )}
                        <PersonaIconTile
                          icon={persona.icon}
                          color={persona.color}
                          className="flex flex-none self-stretch items-center justify-center"
                          iconClassName="h-[50%] w-[50%]"
                          syncWidthToHeight
                        />
                        <div className="flex min-w-0 flex-col justify-center">
                          <h4 className="flex items-center gap-1.5 text-sm font-medium text-text-default">
                            {persona.name}
                            {persona.is_system && (
                              <span className="border border-border-default bg-surface-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                                System
                              </span>
                            )}
                            {isLocalPersona(persona) && (
                              <span className="border border-border-subtle bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                                Local
                              </span>
                            )}
                            {persona.deleted_at && (
                              <span className="border border-status-error-text bg-status-error-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-status-error-text">
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
                                onClick={() => handleDeleteRequest(persona)}
                                disabled={
                                  isPreparingDelete ||
                                  hardDeletePersona.isPending
                                }
                                className="px-2 py-1 text-xs text-status-error-text hover:bg-status-error-bg transition-colors"
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
                                onClick={() => handleDeleteRequest(persona)}
                                disabled={
                                  isPreparingDelete || deletePersona.isPending
                                }
                                className="p-2 text-text-muted hover:text-status-error-text hover:bg-status-error-bg transition-colors"
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
          </div>
        )}
      </ModalShell>
      <ConfirmDialog
        open={isBulkDeleteDialogOpen}
        title={bulkDeleteTitle}
        description={bulkDeleteDescription}
        confirmLabel="Review selected"
        cancelLabel="Cancel"
        destructive
        loading={isPreparingBulkDelete}
        onCancel={() => setIsBulkDeleteDialogOpen(false)}
        onConfirm={() => {
          void handleBulkDelete();
        }}
      />
    </>
  );
}
