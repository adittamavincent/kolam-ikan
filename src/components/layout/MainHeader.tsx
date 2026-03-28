"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useStream } from "@/lib/hooks/useStream";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import {
  PanelLeft,
  Globe,
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
  commitCount: number;
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

  // Extract streamId from pathname if we are on a stream page
  const parts = pathname?.split("/").filter(Boolean) || [];
  const streamId = parts.length === 2 ? parts[1] : null;

  const { stream } = useStream(streamId || "");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
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
  const collapseAllActive = Boolean(logState?.allEntriesCollapsed);
  const headerButtonClass =
    "inline-flex h-8 w-8 items-center justify-center border border-border-default/60 bg-surface-subtle text-text-muted shadow-sm transition-all duration-200 hover:border-border-default hover:bg-surface-default hover:text-text-default focus:outline-none focus:ring-2 focus:ring-action-primary-bg/70 disabled:cursor-not-allowed disabled:opacity-40";
  const cloudStatusLabel =
    cloudStatus === "saving"
      ? "Cloud syncing"
      : cloudStatus === "error"
        ? "Cloud error"
        : cloudStatus === "saved"
          ? "Cloud saved"
          : "Cloud idle";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-surface-default px-3">
      <div className="flex min-w-0 items-center gap-3">
        {streamId && !sidebarVisible && (
          <button
            onClick={showSidebar}
            className=" p-1.5 text-text-muted transition-all duration-200 hover:bg-surface-subtle hover:text-text-default focus-visible: focus-visible: focus-visible:"
            title="Show sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}

        {streamId && stream && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-text-default">
              {stream.cabinet?.name}
            </span>
            <span className="text-text-muted">/</span>
            <span className="truncate text-sm font-semibold text-text-default">
              {stream.name}
            </span>

            {stream.stream_kind === "GLOBAL" && (
              <span className="ml-1 inline-flex items-center gap-1 border border-border-default/30 bg-action-primary-bg/10 px-2 py-0.5 text-[11px] font-semibold text-action-primary-bg">
                <Globe className="h-3 w-3" />
                Global
              </span>
            )}
            
            <div
              className="ml-4 flex items-center border-l border-border-default/40 pl-3"
              aria-label={cloudStatusLabel}
              title={cloudStatusLabel}
            >
              {cloudStatus === "saving" ? (
                <RefreshCw className="h-3 w-3 animate-spin text-text-muted/60" />
              ) : cloudStatus === "error" ? (
                <CloudOff className="h-3 w-3 text-red-500" />
              ) : cloudStatus === "saved" ? (
                <Check className="h-3 w-3 text-emerald-500/80" />
              ) : (
                <div className="h-3 w-3 border border-border-default/50" />
              )}
            </div>
          </div>
        )}
      </div>

      {streamId && (
        <div className="flex items-center gap-2">
          {logState && (
            <div className="flex items-center gap-1 border border-border-default/60 bg-surface-subtle/60 p-1">
              <button
                onClick={() =>
                  emit("kolam_header_log_toggle_compact_all", {
                    collapsed: !collapseAllActive,
                  })
                }
                disabled={!hasEntries}
                className={`${headerButtonClass} relative ${
                  collapseAllActive
                    ? "border-action-primary-bg/40 bg-action-primary-bg/12 text-action-primary-bg"
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
                className={`${headerButtonClass} ${isSearchOpen ? "border-action-primary-bg/35 bg-action-primary-bg/10 text-action-primary-bg" : ""}`}
                title={isSearchOpen ? "Hide search" : "Show search"}
              >
                <Search className="h-4 w-4" />
              </button>

              {isSearchOpen && (
                <div className="relative w-48">
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
                    className="w-full border border-border-default bg-surface-subtle py-1 pl-7 pr-2 text-xs text-text-default focus:border-border-default focus: focus: focus:"
                  />
                </div>
              )}

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

              <button
                onClick={() => emit("kolam_header_log_toggle_stash")}
                className={`${headerButtonClass} ${logState.showStash ? "border-amber-500/40 bg-amber-500/12 text-amber-500" : ""}`}
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
                className={`${headerButtonClass} ${logState.graphView ? "border-action-primary-bg/40 bg-action-primary-bg/12 text-action-primary-bg" : ""}`}
                title={
                  logState.graphView ? "Back to commit list" : "Show commit graph"
                }
              >
                <Network className="h-4 w-4" />
              </button>

              <Menu as="div" className="relative hidden md:block">
                <MenuButton className="inline-flex h-8 items-center gap-1.5 border border-border-default/60 bg-surface-default px-2.5 text-[10px] font-mono text-text-muted shadow-sm transition-all duration-200 hover:border-border-default hover:text-text-default focus:outline-none focus:ring-2 focus:ring-action-primary-bg/70">
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
                    className="z-9999 w-44 overflow-hidden border border-border-default bg-surface-elevated p-1 shadow-2xl focus:"
                  >
                    <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                      Checkout Branch
                    </div>
                    {logState.branchNames?.map((branchName) => (
                      <MenuItem key={branchName}>
                        {({ active }) => (
                          <button
                            onClick={() =>
                              emit("kolam_header_log_set_branch", { branchName })
                            }
                            className={`${active ? "bg-surface-subtle text-text-default" : "text-text-subtle"} flex w-full items-center justify-between  px-2 py-1.5 text-xs transition-all duration-200`}
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
                        const requested = window.prompt(
                          "Branch name",
                          `${logState.currentBranch ?? "main"}-new`,
                        );
                        if (requested === null) return;
                        const branchName = requested.trim();
                        if (!branchName) {
                          window.alert("Branch name is required.");
                          return;
                        }
                        emit("kolam_header_log_create_branch", { branchName });
                      }}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
                    >
                      <Plus className="h-3 w-3" />
                      New branch
                    </button>
                  </MenuItems>
                </Transition>
              </Menu>

              <span className="hidden h-8 items-center gap-1 border border-border-default/60 bg-surface-default px-2.5 text-[10px] font-mono text-text-muted shadow-sm md:inline-flex">
                <GitCommitHorizontal className="h-3 w-3" />
                {logState.commitCount ?? 0}
              </span>
            </div>
          )}

          {canvasState?.hasCanvas && !logState && (
            <div className="flex items-center gap-1 border border-border-default/60 bg-surface-subtle/60 p-1">
              <span
                className="inline-flex h-8 w-8 items-center justify-center border border-border-default/60 bg-surface-default text-text-muted shadow-sm"
                title="Canvas active"
              >
                <Blocks className="h-4 w-4" />
              </span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
