"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { DocumentWithLatestJob } from "@/lib/types";

interface DocumentImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
  onSelectDocument?: (document: DocumentWithLatestJob) => void;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
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
  if (status === "completed") return "bg-emerald-500/15 text-emerald-600";
  if (status === "failed" || status === "canceled")
    return "bg-rose-500/15 text-rose-600";
  if (status === "processing") return "bg-amber-500/15 text-amber-600";
  return "bg-surface-subtle text-text-muted";
}

export function DocumentImportModal({
  isOpen,
  onClose,
  streamId,
  onSelectDocument,
}: DocumentImportModalProps) {
  const {
    documents,
    isLoading,
    createImport,
    cancelImport,
    cancelAllPendingImports,
    deleteCanceledDocument,
  } = useDocuments(streamId);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [flavor, setFlavor] = useState<"lattice" | "stream">("lattice");
  const [enableTableStructure, setEnableTableStructure] = useState(true);
  const [debugDoclingTables, setDebugDoclingTables] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pendingDocuments = useMemo(() => {
    return documents.filter((document) => {
      const status = document.latestJob?.status ?? document.import_status;
      return status === "queued" || status === "processing";
    });
  }, [documents]);

  const derivedTitle = useMemo(() => {
    if (title.trim()) return title.trim();
    if (!selectedFile) return "";
    return selectedFile.name.replace(/\.pdf$/i, "");
  }, [selectedFile, title]);

  const handleClose = () => {
    if (createImport.isPending) return;
    setSubmitError(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) {
      setSubmitError("Select a PDF file first.");
      return;
    }

    setSubmitError(null);

    try {
      await createImport.mutateAsync({
        file: selectedFile,
        title: derivedTitle,
        flavor,
        enableTableStructure,
        debugDoclingTables,
      });

      setSelectedFile(null);
      setTitle("");
      setFlavor("lattice");
      setEnableTableStructure(true);
      setDebugDoclingTables(false);
    } catch (error) {
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

  const handleDeleteCanceledDocument = async (documentId: string) => {
    setSubmitError(null);
    try {
      await deleteCanceledDocument.mutateAsync({ documentId });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Failed to delete canceled document.",
      );
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      className="relative z-50 transition duration-300 ease-out data-closed:opacity-0"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto flex max-h-[90vh] w-full max-w-5xl flex-col gap-6 overflow-y-auto rounded-xl border border-border-default/50 bg-surface-default/95 p-8 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)] backdrop-blur-xl transition duration-300 ease-out data-closed:translate-y-4 data-closed:scale-95 data-closed:opacity-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-2xl font-bold text-text-default">
                Import PDF
              </DialogTitle>
              <p className="mt-1.5 text-sm text-text-muted">
                Upload a source PDF into this stream and queue a Docling import
                job. Worker execution lands through the callback route.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="rounded-lg bg-surface-subtle px-4 py-2 text-sm font-medium text-text-default transition-colors hover:bg-surface-hover"
            >
              Close
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 rounded-2xl border border-border-default bg-surface-subtle/40 p-5"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                <UploadCloud className="h-4 w-4" />
                Queue a new import
              </div>

              <label className="flex flex-col gap-2 text-sm text-text-default">
                <span className="font-medium">PDF file</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) =>
                    setSelectedFile(event.target.files?.[0] ?? null)
                  }
                  className="block w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default file:mr-4 file:rounded-md file:border-0 file:bg-action-primary-bg file:px-3 file:py-2 file:text-sm file:font-semibold file:text-action-primary-text"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-text-default">
                <span className="font-medium">Document title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    selectedFile
                      ? selectedFile.name.replace(/\.pdf$/i, "")
                      : "Derived from filename"
                  }
                  className="w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default outline-none transition-colors focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm text-text-default">
                  <span className="font-medium">Camelot flavor</span>
                  <select
                    value={flavor}
                    onChange={(event) =>
                      setFlavor(event.target.value as "lattice" | "stream")
                    }
                    className="w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default outline-none transition-colors focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg"
                  >
                    <option value="lattice">lattice</option>
                    <option value="stream">stream</option>
                  </select>
                </label>

                <div className="rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-muted">
                  <div className="font-medium text-text-default">
                    Selected file
                  </div>
                  <div className="mt-1 truncate">
                    {selectedFile?.name ?? "No file selected"}
                  </div>
                  <div className="mt-1">
                    {formatBytes(selectedFile?.size ?? null)}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default">
                <input
                  type="checkbox"
                  checked={enableTableStructure}
                  onChange={(event) =>
                    setEnableTableStructure(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-border-default"
                />
                Enable Docling table structure
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-border-default bg-surface-default px-3 py-2 text-sm text-text-default">
                <input
                  type="checkbox"
                  checked={debugDoclingTables}
                  onChange={(event) =>
                    setDebugDoclingTables(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-border-default"
                />
                Export Docling table debug metadata
              </label>

              {submitError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
                  {submitError}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-text-muted">
                  Files are stored in the private document bucket and queued for
                  worker pickup.
                </div>
                <button
                  type="submit"
                  disabled={createImport.isPending}
                  className="whitespace-nowrap shrink-0 inline-flex items-center gap-2 rounded-lg bg-action-primary-bg px-4 py-2 text-sm font-semibold text-action-primary-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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

            <div className="flex min-h-80 flex-col rounded-2xl border border-border-default bg-surface-subtle/40 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-default">
                <FileText className="h-4 w-4" />
                Recent documents
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-default px-3 py-2 text-xs text-text-muted">
                <span>
                  {pendingDocuments.length} pending import
                  {pendingDocuments.length === 1 ? "" : "s"}
                </span>
                <button
                  onClick={handleCancelAllPending}
                  disabled={
                    pendingDocuments.length === 0 ||
                    cancelAllPendingImports.isPending
                  }
                  className="rounded-md border border-border-default px-2 py-1 font-semibold text-text-default transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelAllPendingImports.isPending
                    ? "Canceling..."
                    : "Cancel all pending"}
                </button>
              </div>

              <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                {isLoading && (
                  <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-default px-3 py-3 text-sm text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading documents...
                  </div>
                )}

                {!isLoading && documents.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border-default bg-surface-default px-4 py-6 text-sm text-text-muted">
                    No documents imported into this stream yet.
                  </div>
                )}

                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="rounded-xl border border-border-default bg-surface-default px-4 py-3"
                  >
                    {(() => {
                      const latestJob = document.latestJob;
                      const status =
                        latestJob?.status ?? document.import_status;
                      const progressPercent =
                        latestJob?.progress_percent ??
                        (status === "completed" ? 100 : 0);
                      const progressMessage = latestJob?.progress_message;
                      const eta = formatEta(latestJob?.eta_seconds ?? null);

                      return (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-text-default">
                                {document.title}
                              </div>
                              <div className="truncate text-xs text-text-muted">
                                {document.original_filename}
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${getStatusTone(status)}`}
                            >
                              {status}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-1 text-xs text-text-muted">
                            <div>
                              Created: {formatDate(document.created_at)}
                            </div>
                            <div>
                              Size: {formatBytes(document.file_size_bytes)}
                            </div>
                            <div>Latest job: {status}</div>
                            {progressMessage && (
                              <div>Progress: {progressMessage}</div>
                            )}
                            {eta && <div>ETA: {eta}</div>}
                            {latestJob?.error_message && (
                              <div className="text-rose-600">
                                Error: {latestJob.error_message}
                              </div>
                            )}
                          </div>

                          {(status === "queued" || status === "processing") && (
                            <div className="mt-3 flex justify-end">
                              <button
                                onClick={() =>
                                  handleCancelDocument(document.id)
                                }
                                disabled={
                                  cancelImport.isPending ||
                                  cancelAllPendingImports.isPending ||
                                  deleteCanceledDocument.isPending
                                }
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {cancelImport.isPending
                                  ? "Canceling..."
                                  : "Cancel"}
                              </button>
                            </div>
                          )}

                          {status === "completed" && onSelectDocument && (
                            <div className="mt-3 flex justify-end">
                              <button
                                onClick={() => {
                                  onSelectDocument(document);
                                  handleClose();
                                }}
                                className="rounded-md border border-border-default bg-action-primary-bg px-2.5 py-1 text-xs font-semibold text-action-primary-text transition-opacity hover:opacity-90"
                              >
                                Attach To Entry
                              </button>
                            </div>
                          )}

                          {status === "canceled" && (
                            <div className="mt-3 flex justify-end">
                              <button
                                onClick={() =>
                                  handleDeleteCanceledDocument(document.id)
                                }
                                disabled={
                                  deleteCanceledDocument.isPending ||
                                  cancelImport.isPending ||
                                  cancelAllPendingImports.isPending
                                }
                                className="rounded-md border border-border-default bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-text-default transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deleteCanceledDocument.isPending
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            </div>
                          )}

                          {(status === "queued" ||
                            status === "processing" ||
                            progressPercent > 0) && (
                            <div className="mt-3">
                              <div className="mb-1 flex items-center justify-between text-[11px] text-text-muted">
                                <span>{progressPercent}%</span>
                                {status === "processing" && (
                                  <span>
                                    {progressMessage ?? "Processing document"}
                                  </span>
                                )}
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
                                <div
                                  className="h-full rounded-full bg-action-primary-bg transition-[width] duration-500"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
