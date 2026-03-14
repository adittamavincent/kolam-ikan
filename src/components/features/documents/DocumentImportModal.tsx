"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { DocumentWithLatestJob } from "@/lib/types";
import { calculateFileHash } from "@/lib/utils/hash";
import { PdfAttachmentThumbnail } from "@/components/features/log/PdfAttachmentThumbnail";

// ─── Temp file store access ──────────────────────────────────────────────────
declare global {
  interface Window {
    kolam_temp_files?: Map<
      string,
      { file: File; hash?: string; blobUrl?: string }
    >;
    kolam_pending_file_ids?: string[];
    kolam_consumed_initial_queue_keys?: Set<string>;
  }
}

const getTempFileStore = (): Map<string, { file: File; hash?: string }> => {
  if (typeof window === "undefined") return new Map();
  if (!window.kolam_temp_files) {
    window.kolam_temp_files = new Map();
  }
  return window.kolam_temp_files;
};

const getPendingFileIds = (): string[] => {
  if (typeof window === "undefined") return [];
  if (!window.kolam_pending_file_ids) {
    window.kolam_pending_file_ids = [];
  }
  return window.kolam_pending_file_ids;
};

const setPendingFileIds = (ids: string[]): void => {
  if (typeof window === "undefined") return;
  window.kolam_pending_file_ids = ids;
};

const getConsumedInitialQueueKeys = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  if (!window.kolam_consumed_initial_queue_keys) {
    window.kolam_consumed_initial_queue_keys = new Set();
  }
  return window.kolam_consumed_initial_queue_keys;
};

interface DocumentImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
  onSelectDocument?: (document: DocumentWithLatestJob) => void;
  initialQueuedFiles?: Array<{ file: File; hash?: string }>;
}

function formatBytes(value: number | null) {
  if (value == null) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEta(seconds: number | null | undefined) {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getStatusTone(status: string) {
  if (status === "queued") return "bg-amber-500/15 text-amber-600";
  if (status === "completed") return "bg-emerald-500/15 text-emerald-600";
  if (status === "failed" || status === "canceled")
    return "bg-rose-500/15 text-rose-600";
  if (status === "processing") return "bg-amber-500/15 text-amber-600";
  return "bg-surface-subtle text-text-muted";
}

function getStatusLabel(status: string) {
  if (status === "queued") return "Loading";
  if (status === "processing") return "Processing";
  if (status === "completed") return "Ready";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return status;
}

export function DocumentImportModal({
  isOpen,
  onClose,
  streamId,
  onSelectDocument,
  initialQueuedFiles,
}: DocumentImportModalProps) {
  const {
    documents,
    isLoading,
    createImport,
    cancelImport,
    cancelAllPendingImports,
    deleteDocument,
  } = useDocuments(streamId);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [flavor, setFlavor] = useState<"lattice" | "stream">("lattice");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [enableTableStructure, setEnableTableStructure] = useState(true);
  const [debugDoclingTables, setDebugDoclingTables] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localThumbnails, setLocalThumbnails] = useState<
    Record<string, string>
  >({});
  const localThumbnailsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    localThumbnailsRef.current = localThumbnails;
  }, [localThumbnails]);

  const revokeLocalThumbnails = useCallback(() => {
    Object.values(localThumbnailsRef.current).forEach((url) =>
      URL.revokeObjectURL(url),
    );
    setLocalThumbnails({});
  }, [setLocalThumbnails]);

  // Helper function to process queued file IDs
  const processQueuedFileIds = useCallback(
    (fileIds: string[]) => {
      const tempStore = getTempFileStore();
      const retrievedFiles: Array<{ file: File; hash?: string }> = [];

      for (const id of fileIds) {
        const fileData = tempStore.get(id);
        if (fileData) {
          console.log("[DocumentImportModal] Retrieved file from temp store:", {
            id,
            fileName: fileData.file.name,
            fileSize: fileData.file.size,
            hasHash: !!fileData.hash,
          });
          retrievedFiles.push(fileData);
          tempStore.delete(id); // Clean up after retrieving
        } else {
          console.warn(
            "[DocumentImportModal] File ID not found in temp store:",
            id,
          );
        }
      }

      if (retrievedFiles.length > 0) {
        console.log("[DocumentImportModal] Processing retrieved files:", {
          count: retrievedFiles.length,
        });

        // Start all imports in parallel instead of awaiting each sequentially
        const importPromises = retrievedFiles.map(({ file, hash }) => {
          const derivedTitle = file.name.replace(/\.pdf$/i, "");
          return createImport
            .mutateAsync({
              file,
              title: derivedTitle,
              flavor: "lattice", // default
              enableTableStructure: true, // default
              debugDoclingTables: false, // default
              fileHash: hash,
            })
            .then((res) => {
              console.log("[DocumentImportModal] queued retrieved file:", {
                fileName: file.name,
                result: !!res,
              });
              const docId = res?.document?.id;
              if (docId) {
                const blobUrl = URL.createObjectURL(file);
                setLocalThumbnails((prev) => ({
                  ...prev,
                  [docId]: blobUrl,
                }));
              }
            })
            .catch((error) => {
              console.error(
                "[DocumentImportModal] Error queueing retrieved file:",
                error,
              );
            });
        });

        // Fire-and-forget; ensure all promises are started
        void Promise.allSettled(importPromises);
      }
    },
    [createImport],
  );

  const selectedFilePreviewUrl = useMemo(() => {
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  // Cleanup blob URL when component unmounts or selectedFile changes
  useEffect(() => {
    return () => {
      if (selectedFilePreviewUrl) {
        URL.revokeObjectURL(selectedFilePreviewUrl);
      }
    };
  }, [selectedFilePreviewUrl]);

  // Cleanup local thumbnails when modal closes
  useEffect(() => {
    if (!isOpen) {
      Object.values(localThumbnailsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    }
  }, [isOpen]);

  const cancelableDocuments = useMemo(() => {
    return documents.filter((document) => {
      const status = document.latestJob?.status ?? document.import_status;
      return status === "queued" || status === "processing";
    });
  }, [documents]);

  const derivedTitle = useMemo(() => {
    if (title.trim()) return title.trim();
    if (!selectedFile || !selectedFile.name) {
      console.debug(
        "[DocumentImportModal] derivedTitle: selectedFile or name is missing",
        {
          selectedFileExists: !!selectedFile,
          selectedFileName: selectedFile?.name,
        },
      );
      return "";
    }
    const derived = selectedFile.name.replace(/\.pdf$/i, "");

    console.log("[DocumentImportModal] derivedTitle computed:", {
      original: selectedFile.name,
      derived,
    });
    return derived;
  }, [selectedFile, title]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    revokeLocalThumbnails();
    getConsumedInitialQueueKeys().clear();
    setFileInputKey((k) => k + 1);
    setSelectedFile(null);
    setTitle("");
    onClose();
  }, [onClose, revokeLocalThumbnails]);

  const dialogPanelRef = useRef<HTMLDivElement | null>(null);
  const initialQueueKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleClose]);

  // Listen for files transferred through the temp store via event or when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // First check if there are pending file IDs stored
    const pendingIds = getPendingFileIds();
    console.log(
      "[DocumentImportModal] Checking for pending files on modal open:",
      {
        pendingIds,
        count: pendingIds.length,
      },
    );

    if (pendingIds.length > 0) {
      setPendingFileIds([]); // Clear pending IDs
      processQueuedFileIds(pendingIds);
    }

    // Also listen for real-time events
    const handleFileImportEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { fileIds } = customEvent.detail ?? {};

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        console.warn(
          "[DocumentImportModal] Received event with no fileIds",
          customEvent.detail,
        );
        return;
      }

      console.log(
        "[DocumentImportModal] Received kolam_header_documents_import event with fileIds:",
        fileIds,
      );
      processQueuedFileIds(fileIds);
    };

    window.addEventListener(
      "kolam_header_documents_import",
      handleFileImportEvent,
    );
    return () =>
      window.removeEventListener(
        "kolam_header_documents_import",
        handleFileImportEvent,
      );
  }, [isOpen, processQueuedFileIds]);

  // If parent transfers files into this modal, queue them automatically
  useEffect(() => {
    if (!isOpen || !initialQueuedFiles || initialQueuedFiles.length === 0)
      return;

    console.log("[DocumentImportModal] Received initialQueuedFiles:", {
      count: initialQueuedFiles.length,
      files: initialQueuedFiles.map((f) => ({
        name: f.file?.name,
        size: f.file?.size,
        type: f.file?.type,
        hasHash: !!f.hash,
        isFile: f.file instanceof File,
      })),
    });

    // Build a queue key from valid files only - only require file and name
    const validFiles = initialQueuedFiles.filter((f) => {
      if (!f.file) {
        console.warn("[DocumentImportModal] File is missing", { fileObj: f });
        return false;
      }
      if (!f.file.name) {
        console.warn("[DocumentImportModal] File.name is missing", {
          file: f.file,
        });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      console.warn(
        "[DocumentImportModal] No valid files to queue after filtering",
        { initialQueuedFiles, validFiles },
      );
      return;
    }

    const queueKey = validFiles
      .map(
        ({ file }) =>
          `${file.name}:${file.size ?? 0}:${file.lastModified ?? 0}`,
      )
      .join("|");

    if (initialQueueKeyRef.current === queueKey) return;

    const consumedQueueKeys = getConsumedInitialQueueKeys();
    if (consumedQueueKeys.has(queueKey)) return;

    initialQueueKeyRef.current = queueKey;
    consumedQueueKeys.add(queueKey);

    // Kick off all imports in parallel so UI shows all queued items immediately
    const importPromises = validFiles.map(async ({ file, hash }) => {
      try {
        console.log("[DocumentImportModal] Processing file for import:", {
          fileExists: !!file,
          fileName: file?.name,
          fileSize: file?.size,
          fileType: file?.type,
          fileLastModified: file?.lastModified,
          isFileInstance: file instanceof File,
          hash,
        });

        if (!file || !file.name) {
          console.error("[DocumentImportModal] File or file.name is undefined!", { file });
          setSubmitError("Error: Received file without a valid name. Please try again.");
          return null;
        }

        const derivedTitle = file.name.replace(/\.pdf$/i, "");
        console.log("[DocumentImportModal] Derived title from filename:", {
          original: file.name,
          derived: derivedTitle,
        });

        const result = await createImport.mutateAsync({
          file,
          title: derivedTitle,
          flavor,
          enableTableStructure,
          debugDoclingTables,
          fileHash: hash,
        });

        const docId = result?.document?.id;
        if (docId) {
          const blobUrl = URL.createObjectURL(file);
          setLocalThumbnails((prev) => ({
            ...prev,
            [docId]: blobUrl,
          }));
        }

        return result;
      } catch (error) {
        console.error("[DocumentImportModal] Import error:", error);
        setSubmitError(error instanceof Error ? error.message : "Failed to queue document import.");
        return null;
      }
    });

    void Promise.allSettled(importPromises);
  }, [
    isOpen,
    initialQueuedFiles,
    createImport,
    flavor,
    enableTableStructure,
    debugDoclingTables,
  ]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setSubmitError("Select a PDF file first.");
      return;
    }

    console.log("[DocumentImportModal] handleSubmit started:", {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      derivedTitle,
    });

    setSubmitError(null);

    try {
      const fileHash = await calculateFileHash(selectedFile);

      console.log("[DocumentImportModal] Submitting import:", {
        fileName: selectedFile.name,
        derivedTitle,
        fileHash,
        flavor,
      });

      const result = await createImport.mutateAsync({
        file: selectedFile,
        title: derivedTitle,
        flavor,
        enableTableStructure,
        debugDoclingTables,
        fileHash,
      });

      const docId = result?.document?.id;
      if (docId) {
        // Create a dedicated blob URL for the list view so it survives selectedFile clearance
        const blobUrl = URL.createObjectURL(selectedFile);
        setLocalThumbnails((prev) => ({
          ...prev,
          [docId]: blobUrl,
        }));
      }

      setFileInputKey((k) => k + 1);
      setSelectedFile(null);
      setTitle("");
      setFlavor("lattice");
      setEnableTableStructure(true);
      setDebugDoclingTables(false);
    } catch (error) {
      console.error("[DocumentImportModal] handleSubmit error:", error);
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to queue document import.",
      );
    }
  };

  const handleCancelDocument = async (documentId: string) => {
    setSubmitError(null);
    try {
      await cancelImport.mutateAsync({ documentId });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to cancel import.",
      );
    }
  };

  const handleCancelAllPending = async () => {
    setSubmitError(null);
    try {
      await cancelAllPendingImports.mutateAsync();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to cancel pending imports.",
      );
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    setSubmitError(null);
    try {
      await deleteDocument.mutateAsync({ documentId });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to delete document.",
      );
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      className="relative z-50 transition duration-300 ease-out data-closed:opacity-0"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/25 backdrop-blur-xs transition-opacity" />

      <div
        className="fixed inset-0 overflow-y-auto p-3 lg:p-4"
        onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
          const target = e.target as Node;
          if (
            dialogPanelRef.current &&
            !dialogPanelRef.current.contains(target)
          ) {
            handleClose();
          }
        }}
      >
        <div className="flex min-h-full items-start justify-center">
          <DialogPanel
            ref={dialogPanelRef}
            className="my-auto flex min-h-0 w-full max-w-6xl flex-col gap-3 rounded-xl border border-border-default/70 bg-surface-default/95 p-3 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.32)] backdrop-blur-xl transition duration-300 ease-out data-closed:translate-y-4 data-closed:scale-95 data-closed:opacity-0"
          >
            <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1.6fr)_360px] xl:items-start">
              <form
                onSubmit={handleSubmit}
                className="flex min-h-0 flex-col gap-3 rounded-xl border border-border-default/60 bg-surface-subtle/45 p-3"
              >
                <div className="flex items-center justify-between rounded-xl border border-border-default/60 bg-surface-default px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                    <UploadCloud className="h-4 w-4 text-action-primary-bg" />
                    Import PDF
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs text-text-muted">
                    <Clock3 className="h-3.5 w-3.5" />
                    Queue first, process in background
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_280px]">
                  <label className="flex flex-col gap-2 rounded-xl border border-dashed border-action-primary-bg/30 bg-surface-default p-4 text-sm text-text-default transition-colors hover:border-action-primary-bg/50 hover:bg-surface-subtle/35">
                    <div className="flex items-center justify-between gap-8">
                      <span className="font-medium">PDF file</span>
                      <span className="text-xs text-text-muted">
                        One PDF per import.
                      </span>
                    </div>
                    <input
                      key={fileInputKey}
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(event) =>
                        setSelectedFile(event.target.files?.[0] ?? null)
                      }
                      className="block w-full rounded-xl border border-border-default bg-surface-default px-3 py-3 text-sm text-text-default file:mr-4 file:rounded-sm file:border-0 file:bg-action-primary-bg file:px-3 file:py-2 file:text-sm file:font-semibold file:text-action-primary-text"
                    />
                  </label>

                  <div className="rounded-xl border border-border-default/60 bg-surface-default p-4 text-sm text-text-muted">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                      Selected
                    </div>
                    <div className="mt-3 flex items-start gap-3">
                      <div className="relative shrink-0">
                        <PdfAttachmentThumbnail
                          url={selectedFilePreviewUrl}
                          storagePath={null}
                          thumbnailPath={null}
                          title={selectedFile?.name ?? "No file selected"}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-default">
                          {selectedFile?.name ?? "No file selected"}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {formatBytes(selectedFile?.size ?? null)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <label className="flex-1 flex flex-col gap-2 justify-between rounded-xl border border-border-default/60 bg-surface-default p-4 text-sm text-text-default">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Document title</span>
                      <span className="text-xs text-text-muted">
                        Leave blank to use{" "}
                        <span className="font-medium text-text-subtle">
                          {derivedTitle || "the filename"}
                        </span>
                      </span>
                    </div>
                    <input
                      type="text"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={
                        selectedFile?.name
                          ? selectedFile.name.replace(/\.pdf$/i, "")
                          : "Derived from filename"
                      }
                      className="w-full rounded-xl border border-border-default bg-surface-subtle px-3 py-2.5 text-sm text-text-default outline-none transition-colors focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg"
                    />
                  </label>

                  <label className="flex-1 flex-col gap-2 justify-between rounded-xl border border-border-default/60 bg-surface-default p-4 text-sm text-text-default">
                    <div className="flex items-start justify-between">
                      <span className="font-medium shrink-0">Parsing mode</span>
                      <span className="text-xs leading-5 text-text-muted text-balance flex-1 text-right min-w-0">
                        Use{" "}
                        <span className="font-medium text-text-subtle">
                          lattice
                        </span>{" "}
                        for table borders,{" "}
                        <span className="font-medium text-text-subtle">
                          stream
                        </span>{" "}
                        for text-aligned tables.
                      </span>
                    </div>

                    <div className="relative">
                      <select
                        value={flavor}
                        onChange={(event) =>
                          setFlavor(event.target.value as "lattice" | "stream")
                        }
                        className="w-full appearance-none rounded-xl border border-border-default bg-surface-subtle px-3 py-2.5 pr-8 text-sm text-text-default outline-none transition-colors focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg"
                      >
                        <option value="lattice">lattice</option>
                        <option value="stream">stream</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    </div>
                  </label>
                </div>

                <div className="flex gap-2.5">
                  <label className="w-1/2 flex items-start gap-3 rounded-xl border border-border-default/60 bg-surface-default p-4 text-sm text-text-default transition-colors hover:bg-surface-subtle/35">
                    <input
                      type="checkbox"
                      checked={enableTableStructure}
                      onChange={(event) =>
                        setEnableTableStructure(event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded-sm border-border-default"
                    />
                    <div>
                      <div className="font-medium text-text-default">
                        Enable Docling table structure
                      </div>
                      <div className="mt-1 text-xs leading-5 text-text-muted">
                        Keep table rows and columns linked.
                      </div>
                    </div>
                  </label>

                  <label className="w-1/2 flex items-start gap-3 rounded-xl border border-border-default/60 bg-surface-default p-4 text-sm text-text-default transition-colors hover:bg-surface-subtle/35">
                    <input
                      type="checkbox"
                      checked={debugDoclingTables}
                      onChange={(event) =>
                        setDebugDoclingTables(event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded-sm border-border-default"
                    />
                    <div>
                      <div className="font-medium text-text-default">
                        Export Docling debug metadata
                      </div>
                      <div className="mt-1 text-xs leading-5 text-text-muted">
                        Include diagnostics for troubleshooting.
                      </div>
                    </div>
                  </label>
                </div>

                {submitError && (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    {submitError}
                  </div>
                )}

                <div className="flex flex-col gap-2 rounded-xl border border-border-default/60 bg-surface-default p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-text-default">
                      Ready to queue
                    </div>
                    <div className="mt-1 text-xs leading-5 text-text-muted">
                      Shows up instantly in the queue.
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={createImport.isPending}
                    className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-action-primary-bg px-5 py-3 text-sm font-semibold text-action-primary-text transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createImport.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UploadCloud className="h-4 w-4" />
                    )}
                    Queue Import
                  </button>
                </div>
              </form>

              <div className="flex min-h-0 w-full flex-col items-stretch gap-2 rounded-xl border border-border-default/60 bg-surface-subtle/45 p-3">
                {cancelableDocuments.length > 0 && (
                  <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-default/60 bg-surface-default px-3 py-2 text-xs text-text-muted">
                    <div>
                      <div className="font-semibold text-text-default">
                        {cancelableDocuments.length} active import
                        {cancelableDocuments.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <button
                      onClick={handleCancelAllPending}
                      disabled={cancelAllPendingImports.isPending}
                      className="shrink-0 rounded-xl border border-border-default bg-surface-subtle px-3 py-2 font-semibold text-text-default transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {cancelAllPendingImports.isPending
                        ? "Canceling..."
                        : "Cancel all pending"}
                    </button>
                  </div>
                )}

                <div className="min-h-0 w-full flex-1 space-y-2.5 overflow-y-auto">
                  {isLoading && (
                    <div className="flex items-center gap-2 rounded-xl border border-border-default/60 bg-surface-default px-4 py-4 text-sm text-text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading documents...
                    </div>
                  )}

                  {!isLoading && documents.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border-default/80 bg-surface-default px-4 py-6 text-sm text-text-muted">
                      <div className="flex items-center gap-2 text-text-default">
                        <CheckCircle2 className="h-4 w-4 text-action-primary-bg" />
                        Nothing queued yet
                      </div>
                    </div>
                  )}

                  {documents.map((document) => {
                    const latestJob = document.latestJob;
                    const status = latestJob?.status ?? document.import_status;
                    const progressPercent =
                      latestJob?.progress_percent ??
                      (status === "completed" ? 100 : 0);
                    const progressMessage = latestJob?.progress_message;
                    const eta = formatEta(latestJob?.eta_seconds ?? null);
                    const isPending =
                      status === "queued" || status === "processing";
                    const showProgress =
                      isPending ||
                      (progressPercent > 0 && status !== "completed");

                    return (
                      <div
                        key={document.id}
                        className="relative rounded-xl border border-border-default/60 bg-surface-default p-4"
                      >
                        {/* X Icon Action Button */}
                        {(isPending || status !== "processing") && (
                          <button
                            type="button"
                            aria-label={
                              isPending ? "Cancel import" : "Delete document"
                            }
                            onClick={() => {
                              if (isPending) {
                                handleCancelDocument(document.id);
                              } else {
                                const confirmed = window.confirm(
                                  "Delete this parsed file permanently? This removes it from storage and sections using it may break.",
                                );
                                if (!confirmed) return;
                                void handleDeleteDocument(document.id);
                              }
                            }}
                            disabled={
                              cancelImport.isPending ||
                              cancelAllPendingImports.isPending ||
                              deleteDocument.isPending
                            }
                            className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-xl bg-transparent text-text-muted hover:bg-surface-hover hover:text-rose-600 focus:outline-none disabled:opacity-60"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-5 w-5"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        )}
                        {/* Top Part */}
                        <div className="flex items-center justify-between gap-3">
                          {/* Thumbnail */}
                            <div className="relative shrink-0">
                            <PdfAttachmentThumbnail
                              url={localThumbnails[document.id] || null}
                              storagePath={document.storage_path}
                              thumbnailPath={document.thumbnail_path}
                              title={document.title}
                              importStatus={status}
                              progressPercent={progressPercent}
                            />
                          </div>
                          {/* Right */}
                          <div className="min-w-0 max-w-full flex-1">
                            {/* Collected */}
                            <div className="flex min-w-0 items-center gap-2.5">
                              {/* Document Info */}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-text-default">
                                  {document.title}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-text-muted">
                                  <span className="truncate">
                                    {document.original_filename}
                                  </span>
                                  <span className="shrink-0">·</span>
                                  <span className="shrink-0">
                                    {formatBytes(document.file_size_bytes)}
                                  </span>
                                </div>
                              </div>
                              {/* Status */}
                              <span
                                className={`shrink-0 inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getStatusTone(status)}`}
                              >
                                {status === "queued" && (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                                {getStatusLabel(status)}
                              </span>
                            </div>
                            {/* Progress Information */}
                            {status === "processing" && (
                              <div className="flex items-center gap-2 w-full">
                                {/* Progress Indicator */}
                                <div className="h-1.5 flex-1 overflow-hidden rounded-xl bg-surface-subtle">
                                  <div
                                    className="h-full rounded-xl bg-action-primary-bg transition-[width] duration-500"
                                    style={{ width: `${progressPercent}%` }}
                                  />
                                </div>
                                <span className="shrink-0 min-w-9 text-right text-xs font-semibold text-text-default">
                                  {progressPercent}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Bottom Part */}
                        <div className="mt-2 flex-1 flex-wrap items-center justify-between gap-2">
                          {/* Attach Button (if completed) */}
                          <div className="flex flex-wrap items-center gap-2">
                            {status === "completed" && onSelectDocument && (
                              <button
                                onClick={() => {
                                  onSelectDocument(document);
                                  handleClose();
                                }}
                                className="shrink-0 rounded-xl border border-action-primary-bg bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-action-primary-text transition-opacity hover:opacity-90"
                              >
                                Attach
                              </button>
                            )}
                          </div>
                          {/* Progress Information */}
                          <div className="flex-1 items-center gap-3">
                            {/* Error Message */}
                            {latestJob?.error_message && (
                              <div className="rounded-sm border border-rose-500/25 bg-rose-500/8 px-2.5 py-1.5 text-xs text-rose-600">
                                {latestJob.error_message}
                              </div>
                            )}
                            {/* Progress Bar */}
                            {showProgress && (
                              <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                                {/* Progress Message */}
                                {progressMessage && (
                                  <span
                                    className="truncate shrink min-w-0"
                                    title={progressMessage}
                                  >
                                    {progressMessage}
                                  </span>
                                )}
                                {eta && (
                                  <span className="shrink-0">ETA {eta}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
