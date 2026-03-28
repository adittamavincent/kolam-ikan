"use client";

import { Fragment, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useStream } from "@/lib/hooks/useStream";
import { createClient } from "@/lib/supabase/client";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import {
  PanelLeft,
  Search,
  Download,
  FileUp,
  MessageSquare,
  Archive,
  ArrowUpDown,
  Network,
  GitBranch,
  GitCommitHorizontal,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  CloudOff,
  RefreshCw,
  Blocks,
} from "lucide-react";

type LogHeaderState = {
  streamId: string;
  currentBranch: string;
  currentBranchHeadId?: string | null;
  commitCount: number;
  canvasCommitCount?: number;
  showStash: boolean;
  stashCount: number;
  graphView: boolean;
  sortOrder: "newest" | "oldest";
  searchTerm: string;
  branchNames: string[];
  collapsedEntryCount?: number;
  allEntriesCollapsed?: boolean;
  status?: "idle" | "saving" | "saved" | "error";
  syncStatus?: "idle" | "syncing" | "synced" | "error";
  localStatus?: "idle" | "saving" | "saved" | "error" | "dirty";
  isDirty?: boolean;
};

type CanvasHeaderState = {
  streamId: string;
  hasCanvas: boolean;
  snapshotName: string;
  isSavingSnapshot: boolean;
  syncStatus?: "idle" | "syncing" | "synced" | "error";
  localStatus?: "idle" | "saving" | "saved" | "error" | "dirty";
  isDirty?: boolean;
};

export function MainHeader() {
  const pathname = usePathname();
  const { visible: sidebarVisible, show: showSidebar } = useSidebar();
  const queryClient = useQueryClient();

  // Extract streamId from pathname if we are on a stream page
  const parts = pathname?.split("/").filter(Boolean) || [];
  const domainId = parts.length >= 1 ? parts[0] : null;
  const streamId = parts.length === 2 ? parts[1] : null;

  const { stream } = useStream(streamId || "");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [logState, setLogState] = useState<LogHeaderState | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasHeaderState | null>(
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onLogState = (event: Event) => {
      const detail = (event as CustomEvent<Partial<LogHeaderState>>).detail;
      if (detail?.streamId === streamId) {
        setLogState((prev) => {
          if (!prev) return detail as LogHeaderState;
          return { ...prev, ...detail };
        });
        if (detail.searchTerm !== undefined) {
          setSearchTerm(detail.searchTerm ?? "");
        }
      }
    };

    const onCanvasState = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CanvasHeaderState>>).detail;
      if (detail?.streamId === streamId) {
        setCanvasState((prev) => {
          if (!prev) return detail as CanvasHeaderState;
          return { ...prev, ...detail };
        });
      }
    };

    window.addEventListener("kolam_log_state", onLogState as EventListener);
    window.addEventListener(
      "kolam_canvas_state",
      onCanvasState as EventListener,
    );

    return () => {
      window.removeEventListener(
        "kolam_log_state",
        onLogState as EventListener,
      );
      window.removeEventListener(
        "kolam_canvas_state",
        onCanvasState as EventListener,
      );
    };
  }, [streamId]);

  const emit = (eventName: string, detail?: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  };

  const updateDescriptionMutation = useMutation({
    mutationFn: async (description: string | null) => {
      if (!streamId) return null;
      const supabase = createClient();

      const { data, error } = await supabase
        .from("streams")
        .update({
          description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", streamId)
        .select("*, domain:domains(*), cabinet:cabinets(*)")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (!streamId) return;
      queryClient.setQueryData(["stream", streamId], data);
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      }
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  // Cloud sync = database persistence (mostly for Canvas)
  const getCloudSyncStatus = () => {
    const hasError =
      canvasState?.syncStatus === "error" || logState?.syncStatus === "error";
    const isSaving =
      canvasState?.syncStatus === "syncing" ||
      logState?.syncStatus === "syncing";
    const isDirty = Boolean(canvasState?.isDirty || logState?.isDirty);
    const isSavedFromCanvas =
      canvasState?.syncStatus === "synced" ||
      (canvasState?.syncStatus === "idle" && !canvasState?.isDirty);
    const isSavedFromLog =
      logState?.syncStatus === "synced" ||
      (logState?.syncStatus === "idle" && !logState?.isDirty);

    if (hasError) return "error";
    if (isSaving || isDirty) return "saving";
    if (isSavedFromCanvas || isSavedFromLog) return "saved";
    return "idle";
  };

  const cloudStatus = getCloudSyncStatus();
  const collapsedEntryCount = logState?.collapsedEntryCount ?? 0;
  const hasEntries = (logState?.commitCount ?? 0) > 0;
  const totalCommitCount =
    (logState?.commitCount ?? 0) + (logState?.canvasCommitCount ?? 0);
  const collapseAllActive = Boolean(logState?.allEntriesCollapsed);
  const headerButtonClass =
    "inline-flex h-7 w-7 items-center justify-center border border-border-default bg-surface-default text-text-muted transition-all duration-150 hover:border-border-default hover:text-text-default focus:outline-none focus:ring-2 focus:ring-action-primary-bg disabled:cursor-not-allowed disabled:border-border-subtle disabled:text-text-muted";
  const cloudStatusLabel =
    cloudStatus === "saving"
      ? "Cloud syncing"
      : cloudStatus === "error"
        ? "Cloud error"
        : cloudStatus === "saved"
          ? "Cloud saved"
          : "Cloud idle";
  const workspaceTitle = streamId
    ? stream?.name ?? "Untitled stream"
    : domainId
      ? "Domain workspace"
      : "Kolam Ikan";
  const summaryPillClass =
    "inline-flex h-7 items-center gap-1.5 border border-border-default bg-surface-default px-2 text-[10px] font-mono text-text-subtle";
  const toolbarLeadGroupClass = "flex items-center gap-1";
  const toolbarGroupClass =
    "flex items-center gap-1 border-l border-border-default pl-2";
  const normalizedDescription = useMemo(() => {
    const value = descriptionDraft.trim();
    return value.length > 0 ? value : null;
  }, [descriptionDraft]);
  const hasDescription = Boolean(stream?.description?.trim());

  const saveDescription = async () => {
    if (!streamId) return;

    const currentValue = stream?.description?.trim() || null;
    if (normalizedDescription === currentValue) {
      setIsEditingDescription(false);
      setDescriptionDraft(stream?.description ?? "");
      return;
    }

    try {
      await updateDescriptionMutation.mutateAsync(normalizedDescription);
      setIsEditingDescription(false);
    } catch {
      setDescriptionDraft(stream?.description ?? "");
      setIsEditingDescription(false);
    }
  };

  const handleDescriptionKeyDown = async (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await saveDescription();
      return;
    }

    if (event.key === "Escape") {
      setDescriptionDraft(stream?.description ?? "");
      setIsEditingDescription(false);
    }
  };

  return (
    <header className="shrink-0 border-b border-border-default bg-surface-default p-2">
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {domainId && !sidebarVisible && (
              <button
                onClick={showSidebar}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-border-default bg-surface-default text-text-muted transition-all duration-150 hover:border-border-default hover:text-text-default focus:outline-none focus:ring-2 focus:ring-action-primary-bg/70"
                title="Expand navigator"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            )}

            <div className="min-w-0 flex-1">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-text-default md:text-base">
                    {workspaceTitle}
                  </span>
                  {streamId && (
                    <>
                      {isEditingDescription ? (
                        <input
                          value={descriptionDraft}
                          onChange={(event) => setDescriptionDraft(event.target.value)}
                          onBlur={() => void saveDescription()}
                          onKeyDown={(event) => void handleDescriptionKeyDown(event)}
                          placeholder="Add a description"
                          autoFocus
                          className="w-full max-w-2xl border-0 bg-transparent px-0 py-0 text-xs leading-5 text-text-subtle placeholder:text-text-muted focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDescriptionDraft(stream?.description ?? "");
                            setIsEditingDescription(true);
                          }}
                          className={`block max-w-2xl text-left text-xs leading-5 transition-colors hover:text-text-default ${
                            hasDescription ? "text-text-subtle" : "text-text-muted"
                          }`}
                        >
                          {stream?.description?.trim() || "Add a description"}
                        </button>
                      )}
                    </>
                  )}
                </div>  
              </div>
            </div>
          </div>

          {streamId && (
            <div className="flex flex-col items-start gap-1.5 border-t border-border-default pt-2 xl:items-end xl:border-t-0 xl:pt-0">
              {logState && (
                <>
                  <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
                    <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                      <div className={toolbarLeadGroupClass}>
                        <span
                          className={`${headerButtonClass} pointer-events-none ${
                            cloudStatus === "saving"
                              ? "border-amber-800 text-amber-300"
                              : cloudStatus === "error"
                                ? "border-red-800 text-red-300"
                                : cloudStatus === "saved"
                                  ? "border-emerald-800 text-emerald-300"
                                  : ""
                          }`}
                          aria-label={cloudStatusLabel}
                          title={cloudStatusLabel}
                        >
                          {cloudStatus === "saving" ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : cloudStatus === "error" ? (
                            <CloudOff className="h-3.5 w-3.5" />
                          ) : cloudStatus === "saved" ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <div className="h-3 w-3 border border-current" />
                          )}
                        </span>

                        <button
                          onClick={() =>
                            emit("kolam_header_log_toggle_compact_all", {
                              collapsed: !collapseAllActive,
                            })
                          }
                          disabled={!hasEntries}
                          className={`${headerButtonClass} relative ${
                            collapseAllActive
                              ? "border-primary-800 bg-primary-950 text-action-primary-bg"
                              : collapsedEntryCount > 0
                                ? "text-text-default"
                                : ""
                          }`}
                          title={
                            collapseAllActive
                              ? "Expand all commits"
                              : "Compact all commits"
                          }
                        >
                          {collapseAllActive ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                          {collapsedEntryCount > 0 && (
                            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center border border-surface-default bg-surface-elevated px-1 text-[9px] font-bold leading-none text-text-muted">
                              {collapsedEntryCount}
                            </span>
                          )}
                        </button>

                        <button
                          onClick={() => setIsSearchOpen((prev) => !prev)}
                          className={`${headerButtonClass} ${isSearchOpen ? "border-primary-800 bg-primary-950 text-action-primary-bg" : ""}`}
                          title={isSearchOpen ? "Hide search" : "Show search"}
                        >
                          <Search className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => emit("kolam_header_log_toggle_stash")}
                          className={`${headerButtonClass} ${logState.showStash ? "border-amber-800 bg-amber-950 text-amber-500" : ""}`}
                          title={
                            logState.showStash
                              ? "Hide stashed entries"
                              : `Show stash (${logState.stashCount ?? 0})`
                          }
                        >
                          <Archive className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => emit("kolam_header_log_toggle_sort")}
                          className={headerButtonClass}
                          title={`Sort: ${logState.sortOrder === "newest" ? "Newest First" : "Oldest First"}`}
                        >
                          <ArrowUpDown
                            className={`h-4 w-4 transition-transform ${logState.sortOrder === "oldest" ? "rotate-180" : ""}`}
                          />
                        </button>

                        <button
                          onClick={() => emit("kolam_header_log_toggle_graph")}
                          className={`${headerButtonClass} ${logState.graphView ? "border-primary-800 bg-primary-950 text-action-primary-bg" : ""}`}
                          title={
                            logState.graphView
                              ? "Back to commit list"
                              : "Show commit graph"
                          }
                        >
                          <Network className="h-4 w-4" />
                        </button>

                        {isSearchOpen && (
                          <div className="relative ml-1 w-full min-w-45 max-w-xs">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                            <input
                              type="text"
                              value={searchTerm}
                              onChange={(event) => {
                                const term = event.target.value;
                                setSearchTerm(term);
                                emit("kolam_header_log_search_term", { term });
                              }}
                              placeholder="Search commits..."
                              className="w-full border border-border-default bg-surface-default py-2 pl-7 pr-2 text-xs text-text-default focus:border-border-default focus: focus: focus:"
                            />
                          </div>
                        )}
                      </div>

                      <div className={toolbarGroupClass}>
                        <button
                          onClick={() => emit("kolam_header_whatsapp_import")}
                          className={headerButtonClass}
                          title="Import WhatsApp Chat"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => emit("kolam_header_documents_import")}
                          className={headerButtonClass}
                          title="Import PDF"
                        >
                          <FileUp className="h-4 w-4" />
                        </button>

                        <button
                          onClick={() => emit("kolam_header_log_export")}
                          className={headerButtonClass}
                          title="Export to Markdown"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className={toolbarGroupClass}>
                      <Menu as="div" className="relative hidden md:block">
                        <MenuButton className="inline-flex h-7 items-center gap-1.5 border border-border-default bg-surface-default px-2 text-[10px] font-mono text-text-muted transition-all duration-150 hover:border-border-default hover:text-text-default focus:outline-none focus:ring-2 focus:ring-action-primary-bg/70">
                          <GitBranch className="h-3 w-3" />
                          {logState.currentBranch ?? "main"}
                          <ChevronDown className="h-3 w-3" />
                        </MenuButton>
                        <Transition
                          as={Fragment}
                          enter="transition ease-out duration-100"
                          enterFrom="transform opacity-0 scale-95"
                          enterTo="transform opacity-100 scale-100"
                          leave="transition ease-in duration-75"
                          leaveFrom="transform opacity-100 scale-100"
                          leaveTo="transform opacity-0 scale-95"
                        >
                          <MenuItems
                            anchor={{ to: "bottom end", gap: 6 }}
                            portal
                            className="z-9999 w-44 overflow-hidden border border-border-default bg-surface-elevated p-1 focus:"
                          >
                            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                              Checkout Branch
                            </div>
                            {logState.branchNames?.map((branchName) => (
                              <MenuItem key={branchName}>
                                {({ active }) => (
                                  <button
                                    onClick={() =>
                                      emit("kolam_header_log_set_branch", {
                                        branchName,
                                      })
                                    }
                                    className={`${active ? "bg-surface-subtle text-text-default" : "text-text-subtle"} flex w-full items-center justify-between px-2 py-1.5 text-xs transition-all duration-200`}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <GitBranch className="h-3 w-3" />
                                      {branchName}
                                    </span>
                                    {logState.currentBranch === branchName && (
                                      <Check className="h-3 w-3 text-action-primary-bg" />
                                    )}
                                  </button>
                                )}
                              </MenuItem>
                            ))}
                            <div className="my-1 h-px bg-border-subtle" />
                            <button
                              onClick={() => {
                                emit("kolam_header_log_open_create_branch", {
                                  defaultBranchName: `${logState.currentBranch ?? "main"}-new`,
                                });
                              }}
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
                            >
                              <Plus className="h-3 w-3" />
                              New branch
                            </button>
                          </MenuItems>
                        </Transition>
                      </Menu>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                      <span className={summaryPillClass}>
                        <GitCommitHorizontal className="h-3 w-3" />
                        {totalCommitCount} commits
                      </span>
                      <span className={summaryPillClass}>
                        <Archive className="h-3 w-3" />
                        {logState.stashCount ?? 0} stashed
                      </span>
                    </div>
                  </div>
                </>
              )}

              {canvasState?.hasCanvas && !logState && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className={toolbarGroupClass}>
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center border border-border-default bg-surface-default text-text-muted"
                      title="Canvas active"
                    >
                      <Blocks className="h-4 w-4" />
                    </span>
                    <span className="inline-flex h-7 items-center border border-border-default bg-surface-default px-2 text-[10px] font-mono text-text-muted">
                      Snapshot live
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
