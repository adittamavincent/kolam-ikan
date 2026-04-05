"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
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
import { stripImportFileExtension } from "@/lib/documents/importCompatibility";
import { calculateFileHash } from "@/lib/utils/hash";
import { FileAttachmentThumbnail } from "@/components/features/log/FileAttachmentThumbnail";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import { useBlobUrl } from "@/lib/hooks/useBlobUrl";

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
  if (status === "queued")
    return "bg-amber-100 text-amber-700";
  if (status === "completed")
    return "bg-emerald-100 text-emerald-700";
  if (status === "failed" || status === "canceled")
    return "bg-rose-100 text-rose-700";
  if (status === "processing")
    return "bg-amber-100 text-amber-700";
  return "bg-slate-50 text-slate-500";
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
  const formId = "document-import-form";
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
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [localThumbnails, setLocalThumbnails] = useState<
    Record<string, string>
  >({});
  const localThumbnailsRef = useRef<Record<string, string>>({});
  const [documentToDelete, setDocumentToDelete] =
    useState<DocumentWithLatestJob | null>(null);
  const [duplicateConfirmState, setDuplicateConfirmState] = useState<{
    file: File;
    existingDoc: DocumentWithLatestJob;
  } | null>(null);

  useEffect(() => {
    localThumbnailsRef.current = localThumbnails;
  }, [localThumbnails]);

  const revokeLocalThumbnails = useCallback(() => {
    Object.values(localThumbnailsRef.current).forEach((url) =>
      URL.revokeObjectURL(url),
    );
    setLocalThumbnails({});
  }, [setLocalThumbnails]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    setSubmitWarning(null);
    revokeLocalThumbnails();
    getConsumedInitialQueueKeys().clear();
    setFileInputKey((k) => k + 1);
    setSelectedFile(null);
    setTitle("");
    onClose();
  }, [onClose, revokeLocalThumbnails]);

  // Helper function to process queued file IDs
  const processQueuedFileIds = useCallback(
    async (fileIds: string[]) => {
      const tempStore = getTempFileStore();
      const retrievedFiles: Array<{ file: File; hash?: string }> = [];

      for (const id of fileIds) {
        const fileData = tempStore.get(id);
        if (fileData) {
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
        // For each retrieved file, check hash against existing documents and
        // reuse existing document when a matching hash is found. Otherwise
        // queue a new import. Start all imports in parallel.
        const importPromises = retrievedFiles.map(async ({ file, hash }) => {
          try {
            const fileHash = hash ?? (await calculateFileHash(file));

            const existingDoc = documents.find(
              (d) =>
                (d.source_metadata as Record<string, unknown>)?.fileHash ===
                fileHash,
            );

            if (existingDoc) {
              if (onSelectDocument) {
                onSelectDocument(existingDoc);
                handleClose();
                return null;
              }

              setSubmitWarning(
                `The file "${file.name}" already exists as "${existingDoc.title}". Reusing existing document.`,
              );
              return null;
            }

            const derivedTitle = stripImportFileExtension(file.name);
            const res = await createImport.mutateAsync({
              file,
              title: derivedTitle,
              flavor: "lattice",
              enableTableStructure: true,
              debugDoclingTables: false,
              fileHash,
            });

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
          } catch (error) {
            console.error(
              "[DocumentImportModal] Error queueing retrieved file:",
              error,
            );
          }
          return null;
        });

        // Fire-and-forget; ensure all promises are started
        void Promise.allSettled(importPromises);
      }
    },
    [createImport, documents, handleClose, onSelectDocument],
  );

  const selectedFilePreviewUrl = useBlobUrl(selectedFile);

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
      return "";
    }
    const derived = stripImportFileExtension(selectedFile.name);
    return derived;
  }, [selectedFile, title]);

  const initialQueueKeyRef = useRef<string | null>(null);

  // Listen for files transferred through the temp store via event or when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // First check if there are pending file IDs stored
    const pendingIds = getPendingFileIds();

    if (pendingIds.length > 0) {
      setPendingFileIds([]); // Clear pending IDs
      processQueuedFileIds(pendingIds);
    } else {
      // Fallback: if no pending IDs were stored but there are files in the
      // global temp store, attempt to process those to avoid dropped files.
      const tempStore = getTempFileStore();
      const fallbackKeys = Array.from(tempStore.keys());
      if (fallbackKeys.length > 0) {
        console.warn(
          "[DocumentImportModal] No pending IDs found, falling back to temp store keys:",
          fallbackKeys,
        );
        processQueuedFileIds(fallbackKeys);
      }
    }

    // Also listen for real-time events
    const handleFileImportEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { fileIds } = customEvent.detail ?? {};

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        console.warn(
          "[DocumentImportModal] Received event with no fileIds, will attempt to use temp store instead",
          customEvent.detail,
        );
        const tempStore = getTempFileStore();
        const keys = Array.from(tempStore.keys());
        if (keys.length === 0) return;
        processQueuedFileIds(keys);
        return;
      }

      // Try to process the provided IDs first. If some IDs are not present in
      // the temp store (race or cleanup), fall back to processing any remaining
      // keys in the temp store so we don't drop files.
      processQueuedFileIds(fileIds).catch(() => {
        const tempStore = getTempFileStore();
        const keys = Array.from(tempStore.keys());
        if (keys.length === 0) return;
        console.warn(
          "[DocumentImportModal] Some provided fileIds could not be processed; falling back to temp store keys:",
          keys,
        );
        processQueuedFileIds(keys);
      });
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
        if (!file || !file.name) {
          console.error(
            "[DocumentImportModal] File or file.name is undefined!",
            { file },
          );
          setSubmitError(
            "Error: Received file without a valid name. Please try again.",
          );
          return null;
        }

        const fileHash = hash ?? (await calculateFileHash(file));

        const existingDoc = documents.find(
          (d) =>
            (d.source_metadata as Record<string, unknown>)?.fileHash ===
            fileHash,
        );

        if (existingDoc) {
          if (onSelectDocument) {
            onSelectDocument(existingDoc);
            handleClose();
            return null;
          }

          setSubmitWarning(
            `The file "${file.name}" is already in this library as "${existingDoc.title}".`,
          );
          return null;
        }

        const derivedTitle = stripImportFileExtension(file.name);

        const result = await createImport.mutateAsync({
          file,
          title: derivedTitle,
          flavor,
          enableTableStructure,
          debugDoclingTables,
          fileHash,
        });

        if (result?.reused) {
          setSubmitWarning(
            `The file "${file.name}" has already been processed and was reused.`,
          );
        }

        const docId = result?.document?.id || result?.documentId;
        if (docId && !result?.reused) {
          const blobUrl = URL.createObjectURL(file);
          setLocalThumbnails((prev) => ({
            ...prev,
            [docId]: blobUrl,
          }));
        }

        return result;
      } catch (error) {
        console.error("[DocumentImportModal] Import error:", error);
        setSubmitError(
          error instanceof Error
            ? error.message
            : "Failed to queue document import.",
        );
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
    documents,
    onSelectDocument,
    handleClose,
  ]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setSubmitError("Select a file first.");
      return;
    }

    setSubmitError(null);

    try {
      const fileHash = await calculateFileHash(selectedFile);

      const result = await createImport.mutateAsync({
        file: selectedFile,
        title: derivedTitle,
        flavor,
        enableTableStructure,
        debugDoclingTables,
        fileHash,
      });

      if (result?.reused) {
        setSubmitWarning(
          `The file "${selectedFile.name}" has already been processed and was reused.`,
        );
      }

      const docId = result?.document?.id || result?.documentId;
      if (docId && !result?.reused) {
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

  const handleConfirmDocumentDeletion = async () => {
    if (!documentToDelete) return;
    if ((documentToDelete.usageCount ?? 0) > 0) {
      setSubmitError(
        "This file is still attached to one or more sections and cannot be deleted.",
      );
      setDocumentToDelete(null);
      return;
    }
    const { id } = documentToDelete;
    setDocumentToDelete(null);
    await handleDeleteDocument(id);
  };

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={handleClose}
        viewportClassName="fixed inset-0 overflow-y-auto p-3 lg:p-4"
        contentClassName="flex min-h-full items-start justify-center"
        panelClassName="my-auto flex min-h-0 w-full flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        footerMeta={
          <div>
            <div className="font-semibold text-slate-800">
              Ready to queue
            </div>
            <div className="mt-1 leading-5 text-slate-500">
              Shows up instantly in the queue.
            </div>
          </div>
        }
        footerActions={[
          {
            label: "Close",
            onClick: handleClose,
            tone: "secondary",
          },
          {
            label: "Queue Import",
            icon: createImport.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            ),
            type: "submit",
            form: formId,
            disabled: !selectedFile || createImport.isPending,
            tone: "primary",
          },
        ]}
      >
        <ModalHeader
          title="Document Import"
          description="Queue a file for background processing and manage the imported files already available in this view."
          icon={<UploadCloud className="h-4 w-4" />}
          onClose={handleClose}
          meta={
            <div className="inline-flex items-center gap-2 text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              Queue first, process in background
            </div>
          }
        />

        <div className="grid min-h-0 gap-3 px-6 py-5">
          <form
            id={formId}
            onSubmit={handleSubmit}
            className="flex min-h-0 min-w-0 flex-col gap-3 border border-slate-300 bg-slate-50 p-3"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_280px]">
              <label className="flex flex-col gap-2 border border-dashed border-slate-200 bg-white p-4 text-slate-800 transition-colors hover:bg-slate-50">
                <div className="flex items-center justify-between gap-8">
                  <span className="font-medium">File</span>
                  <span className="text-slate-500">
                    One compatible file per import.
                  </span>
                </div>
                <input
                  key={fileInputKey}
                  type="file"
                  accept="*/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null;

                    setSubmitWarning(null);
                    setSubmitError(null);

                    if (file) {
                      try {
                        const hash = await calculateFileHash(file);
                        const existingDoc = documents.find(
                          (d) =>
                            (d.source_metadata as Record<string, unknown>)
                              ?.fileHash === hash,
                        );

                        if (existingDoc) {
                          // Always prompt the user when a matching-hash document exists.
                          // Do not set the selected file yet — wait for explicit confirmation.
                          setDuplicateConfirmState({ file, existingDoc });
                          event.target.value = "";
                          return;
                        }
                      } catch (err) {
                        console.error("Failed to hash file", err);
                      }
                    }

                    setSelectedFile(file);
                    // Reset input so same file can be selected again
                    event.target.value = "";
                  }}
                  className="block w-full border border-slate-300 bg-white px-3 py-3 text-slate-800 file:mr-4 file: file:border-none file:bg-blue-500 file:px-3 file:py-2 file:font-semibold file:text-white"
                />
              </label>

              <div className="border border-slate-300 bg-white p-4 text-slate-500">
                <div className="font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Selected
                </div>
                <div className="mt-3 flex items-start gap-3">
                  <div className="relative shrink-0">
                    <FileAttachmentThumbnail
                      url={selectedFilePreviewUrl}
                      storagePath={null}
                      thumbnailPath={null}
                      thumbnailStatus={null}
                      documentId={null}
                      title={selectedFile?.name ?? "No file selected"}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">
                      {selectedFile?.name ?? "No file selected"}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {formatBytes(selectedFile?.size ?? null)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row">
              <label className="flex-1 flex flex-col gap-2 justify-between border border-slate-300 bg-white p-4 text-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Document title</span>
                  <span className="text-slate-500">
                    Leave blank to use{" "}
                    <span className="font-medium text-slate-600">
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
                      ? stripImportFileExtension(selectedFile.name)
                      : "Derived from filename"
                  }
                  className="w-full border border-slate-300 bg-slate-50 px-3 py-2.5 text-slate-800 transition-colors focus:border-slate-300 focus: focus:"
                />
              </label>

              <label className="flex-1 flex flex-col gap-2 justify-between border border-slate-300 bg-white p-4 text-slate-800">
                <div className="flex items-start justify-between">
                  <span className="font-medium shrink-0">Parsing mode</span>
                  <span className="leading-5 text-slate-500 text-balance flex-1 text-right min-w-0">
                    Use{" "}
                    <span className="font-medium text-slate-600">
                      lattice
                    </span>{" "}
                    for table borders,{" "}
                    <span className="font-medium text-slate-600">stream</span>{" "}
                    for text-aligned tables.
                  </span>
                </div>

                <div className="relative">
                  <select
                    value={flavor}
                    onChange={(event) =>
                      setFlavor(event.target.value as "lattice" | "stream")
                    }
                    className="w-full appearance-none border border-slate-300 bg-slate-50 px-3 py-2.5 pr-8 text-slate-800 transition-colors focus:border-slate-300 focus: focus:"
                  >
                    <option value="lattice">lattice</option>
                    <option value="stream">stream</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                </div>
              </label>
            </div>

            <div className="grid gap-2.5 md:grid-cols-2">
              <label className="flex items-start gap-3 border border-slate-300 bg-white p-4 text-slate-800 transition-colors hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={enableTableStructure}
                  onChange={(event) =>
                    setEnableTableStructure(event.target.checked)
                  }
                  className="mt-1 h-4 w-4 border-slate-300"
                />
                <div>
                  <div className="font-medium text-slate-800">
                    Enable Docling table structure
                  </div>
                  <div className="mt-1 leading-5 text-slate-500">
                    Keep table rows and columns linked.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 border border-slate-300 bg-white p-4 text-slate-800 transition-colors hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={debugDoclingTables}
                  onChange={(event) =>
                    setDebugDoclingTables(event.target.checked)
                  }
                  className="mt-1 h-4 w-4 border-slate-300"
                />
                <div>
                  <div className="font-medium text-slate-800">
                    Export Docling debug metadata
                  </div>
                  <div className="mt-1 leading-5 text-slate-500">
                    Include diagnostics for troubleshooting.
                  </div>
                </div>
              </label>
            </div>

            {submitError && (
              <div className="flex items-start gap-3 border border-rose-300 bg-rose-100 px-4 py-3 text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {submitError}
              </div>
            )}

            {submitWarning && (
              <div className="flex items-start gap-3 border border-amber-300 bg-amber-100 px-4 py-3 text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {submitWarning}
              </div>
            )}
          </form>

          <div className="flex min-h-0 min-w-0 w-full flex-col items-stretch gap-2 border border-slate-300 bg-slate-50 p-3">
            {cancelableDocuments.length > 0 && (
              <div className="flex w-full items-center justify-between gap-3 border border-slate-300 bg-white px-3 py-2 text-slate-500">
                <div>
                  <div className="font-semibold text-slate-800">
                    {cancelableDocuments.length} active import
                    {cancelableDocuments.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  onClick={handleCancelAllPending}
                  disabled={cancelAllPendingImports.isPending}
                  className="shrink-0 border border-slate-300 bg-slate-50 px-2 py-1 font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelAllPendingImports.isPending
                    ? "Canceling..."
                    : "Cancel all pending"}
                </button>
              </div>
            )}

            <div className="min-h-0 w-full flex-1 space-y-2.5 overflow-y-auto">
              {isLoading && (
                <div className="flex items-center gap-2 border border-slate-300 bg-white px-4 py-4 text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading documents...
                </div>
              )}

              {!isLoading && documents.length === 0 && (
                <div className="border border-dashed border-slate-400 bg-white px-4 py-6 text-slate-500">
                  <div className="flex items-center gap-2 text-slate-800">
                    <CheckCircle2 className="h-4 w-4 text-blue-500" />
                    Nothing queued yet
                  </div>
                </div>
              )}

              {documents.map((document) => {
                const latestJob = document.latestJob;
                const status = latestJob?.status ?? document.import_status;
                const usageCount = document.usageCount ?? 0;
                const isInUse = usageCount > 0;
                const progressPercent =
                  latestJob?.progress_percent ??
                  (status === "completed" ? 100 : 0);
                const progressMessage = latestJob?.progress_message;
                const eta = formatEta(latestJob?.eta_seconds ?? null);
                const isPending =
                  status === "queued" || status === "processing";
                const actionDisabled = isPending
                  ? cancelImport.isPending ||
                    cancelAllPendingImports.isPending ||
                    deleteDocument.isPending
                  : isInUse ||
                    cancelImport.isPending ||
                    cancelAllPendingImports.isPending ||
                    deleteDocument.isPending;
                const showProgress =
                  isPending || (progressPercent > 0 && status !== "completed");

                return (
                  <div
                    key={document.id}
                    className="relative border border-slate-300 bg-white p-4"
                  >
                    {/* X Icon Action Button */}
                    {(isPending || status !== "processing") && (
                      <button
                        type="button"
                        aria-label={
                          isPending ? "Cancel import" : "Delete document"
                        }
                        title={
                          isPending
                            ? "Cancel import"
                            : isInUse
                              ? `Cannot delete while used in ${usageCount} section${usageCount === 1 ? "" : "s"}`
                              : "Delete document"
                        }
                        onClick={() => {
                          if (isPending) {
                            void handleCancelDocument(document.id);
                            return;
                          }
                          if (isInUse) {
                            setSubmitError(
                              "This file is still attached to one or more sections and cannot be deleted.",
                            );
                            return;
                          }
                          setDocumentToDelete(document);
                        }}
                        disabled={actionDisabled}
                        className={`absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center bg-white focus: disabled:text-slate-500 ${
                          isInUse && !isPending
                            ? "cursor-not-allowed text-slate-500"
                            : "text-slate-500 hover:bg-slate-200 hover:text-rose-700"
                        }`}
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
                        <FileAttachmentThumbnail
                          url={localThumbnails[document.id] || null}
                          storagePath={document.storage_path}
                          thumbnailPath={document.thumbnail_path}
                          thumbnailStatus={document.thumbnail_status ?? null}
                          documentId={document.id}
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
                            <div className="truncate font-medium text-slate-800">
                              {document.title}
                            </div>
                            <div className="flex items-center gap-1 text-slate-500">
                              <span className="truncate">
                                {document.original_filename}
                              </span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">
                                {formatBytes(document.file_size_bytes)}
                              </span>
                            </div>
                            <div
                              className={`mt-1 ${isInUse ? "text-amber-700" : "text-slate-500"}`}
                            >
                              {isInUse
                                ? `Used in ${usageCount} section${usageCount === 1 ? "" : "s"}`
                                : "Not used anywhere yet"}
                            </div>
                          </div>
                          {/* Status */}
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 font-semibold uppercase tracking-[0.18em] ${getStatusTone(status)}`}
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
                            <div className="h-1.5 flex-1 overflow-hidden bg-slate-50">
                              <div
                                className="h-full bg-blue-500 transition-[width] duration-500"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <span className="shrink-0 min-w-9 text-right font-semibold text-slate-800">
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
                            className="shrink-0 border border-slate-300 bg-blue-500 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-blue-700"
                          >
                            Attach
                          </button>
                        )}
                      </div>
                      {/* Progress Information */}
                      <div className="flex-1 items-center gap-3">
                        {/* Error Message */}
                        {latestJob?.error_message && (
                          <div className="border border-rose-300 bg-rose-100 px-2.5 py-1.5 text-rose-700">
                            {latestJob.error_message}
                          </div>
                        )}
                        {/* Progress Bar */}
                        {showProgress && (
                          <div className="flex items-center justify-between gap-2 text-slate-500">
                            {/* Progress Message */}
                            {progressMessage && (
                              <span
                                className="truncate shrink min-w-0"
                                title={progressMessage}
                              >
                                {progressMessage}
                              </span>
                            )}
                            {eta && <span className="shrink-0">ETA {eta}</span>}
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
      </ModalShell>
      <ConfirmDialog
        open={Boolean(documentToDelete)}
        title="Delete parsed file permanently?"
        description={
          <span>
            This removes it from storage and any sections that rely on it may
            break.
            {documentToDelete?.title ? ` File: ${documentToDelete?.title}` : ""}
          </span>
        }
        confirmLabel="Delete file"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setDocumentToDelete(null)}
        onConfirm={() => {
          void handleConfirmDocumentDeletion();
        }}
      />
      <ConfirmDialog
        open={Boolean(duplicateConfirmState)}
        title="File Already Imported"
        description={
          duplicateConfirmState
            ? `The file "${duplicateConfirmState.file.name}" has already been imported as "${duplicateConfirmState.existingDoc.title}".`
            : ""
        }
        confirmLabel="Use existing"
        hideCancel
        onCancel={() => setDuplicateConfirmState(null)}
        onConfirm={() => {
          if (!duplicateConfirmState) return;
          if (onSelectDocument) {
            onSelectDocument(duplicateConfirmState.existingDoc);
            handleClose();
          }
          setDuplicateConfirmState(null);
        }}
      />
    </>
  );
}
