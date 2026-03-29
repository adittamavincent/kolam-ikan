"use client";

import { useState } from "react";
import { Paperclip, Trash2, Download } from "lucide-react";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import { FileAttachmentThumbnail } from "@/components/features/log/FileAttachmentThumbnail";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import { useDocuments } from "@/lib/hooks/useDocuments";
import type { DocumentWithLatestJob } from "@/lib/types";

interface AttachmentsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onSelectDocument?: (document: DocumentWithLatestJob) => void;
}

export function AttachmentsManager({
  isOpen,
  onClose,
  userId,
  onSelectDocument,
}: AttachmentsManagerProps) {
  const { documents, isLoading, deleteDocument } = useDocuments(userId);
  const [docImportOpen, setDocImportOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const attachments = documents ?? [];

  const handleAttach = (document: DocumentWithLatestJob) => {
    if (!onSelectDocument) return;
    onSelectDocument(document);
    setRemoveError(null);
    onClose();
  };

  const handleRemove = async (id: string, usageCount: number) => {
    if (usageCount > 0) {
      setRemoveError("This file is still in use and cannot be deleted.");
      return;
    }

    setRemoveError(null);

    try {
      await deleteDocument.mutateAsync({ documentId: id });
    } catch (error) {
      setRemoveError(
        error instanceof Error ? error.message : "Failed to delete document.",
      );
    }
  };

  const handleDownload = (url: string | null, filename: string) => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        panelClassName="w-full"
        footerActions={[
          {
            label: "Close",
            onClick: () => {
              setRemoveError(null);
              onClose();
            },
            tone: "primary",
          },
        ]}
      >
        <ModalHeader
          title="Attachments"
          icon={<Paperclip className="h-5 w-5" />}
          onClose={onClose}
        />

        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setRemoveError(null);
                setDocImportOpen(true);
              }}
              className="inline-flex items-center gap-2 border border-border-default px-3 py-1 text-sm bg-surface-subtle hover:bg-surface-hover"
            >
              <span className="text-xs">Go to import</span>
            </button>
            <p className="text-xs text-text-muted">
              Upload on the Document Import modal.
            </p>
          </div>

          {removeError && (
            <div className="border border-status-error-border bg-status-error-bg px-3 py-2 text-xs text-status-error-text">
              {removeError}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto border border-border-default p-2 bg-surface-default">
            {isLoading && (
              <div className="text-sm text-text-muted">
                Loading attachments…
              </div>
            )}
            {!isLoading && attachments.length === 0 && (
              <div className="text-sm text-text-muted">No attachments yet.</div>
            )}

            <ul className="space-y-2">
              {attachments.map((att) => {
                const name = att.title || att.original_filename || "Document";
                const usageCount = att.usageCount ?? 0;
                const isInUse = usageCount > 0;
                const status = att.latestJob?.status ?? att.import_status;
                const canAttach = status === "completed";
                return (
                  <li
                    key={att.id}
                    className="flex items-center justify-between gap-2 p-2 hover:bg-surface-subtle"
                  >
                    <div className="flex items-center gap-3">
                      <FileAttachmentThumbnail
                        url={att.fileUrl ?? null}
                        storagePath={att.storage_path}
                        thumbnailPath={att.thumbnail_path}
                        thumbnailStatus={att.thumbnail_status}
                        documentId={att.id}
                        title={name}
                        importStatus={att.import_status}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-default">
                          {name}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          {att.file_size_bytes
                            ? `${Math.round(att.file_size_bytes / 1024)} KB`
                            : "—"}
                          {" • "}
                          {att.content_type || "—"}
                        </div>
                        <div
                          className={`text-[10px] ${isInUse ? "text-amber-600" : "text-text-muted"}`}
                        >
                          {isInUse
                            ? `Used in ${usageCount} section${usageCount === 1 ? "" : "s"}`
                            : "Not used anywhere"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {onSelectDocument && (
                        <button
                          type="button"
                          onClick={() => handleAttach(att)}
                          disabled={!canAttach}
                          title={
                            canAttach
                              ? "Attach this file"
                              : "Only completed files can be attached"
                          }
                          className={`border border-border-default px-2 py-1 text-[11px] font-semibold transition-colors ${
                            canAttach
                              ? "bg-action-primary-bg text-action-primary-text hover:opacity-90"
                              : "cursor-not-allowed bg-surface-subtle text-text-muted"
                          }`}
                        >
                          Attach
                        </button>
                      )}
                      <button
                        onClick={() =>
                          handleDownload(att.fileUrl ?? null, name)
                        }
                        className="text-text-muted hover:text-text-default"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          void handleRemove(att.id, usageCount);
                        }}
                        disabled={deleteDocument.isPending || isInUse}
                        title={
                          isInUse
                            ? `Cannot delete while used in ${usageCount} section${usageCount === 1 ? "" : "s"}`
                            : "Delete attachment"
                        }
                        className={`${
                          isInUse
                            ? "cursor-not-allowed text-text-muted"
                            : "text-status-error-text hover:text-status-error-border"
                        } disabled:text-text-muted`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

      </ModalShell>
      <DocumentImportModal
        isOpen={docImportOpen}
        onClose={() => setDocImportOpen(false)}
        streamId={userId}
      />
    </>
  );
}

export default AttachmentsManager;
