import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { Loader2, X } from "lucide-react";

export interface PdfAttachmentPreviewData {
  documentId?: string;
  title: string;
  previewUrl: string | null;
  importStatus?: string | null;
}

export interface ParsedPreviewData {
  documentId: string;
  title: string;
  markdown: string;
}

interface PdfAttachmentPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  attachmentPreview: PdfAttachmentPreviewData | null;
  activePreviewTab: "pdf" | "parsed";
  onActivePreviewTabChange: (tab: "pdf" | "parsed") => void;
  parsedPreview: ParsedPreviewData | null;
  parsedPreviewLoading: boolean;
  parsedPreviewError: string | null;
  onRequestParsedPreview: (documentId: string, titleSnapshot: string) => void;
}

function isParsedReadyStatus(status?: string | null): boolean {
  return status === "completed" || status === "done";
}

export function PdfAttachmentPreviewDialog({
  open,
  onClose,
  attachmentPreview,
  activePreviewTab,
  onActivePreviewTabChange,
  parsedPreview,
  parsedPreviewLoading,
  parsedPreviewError,
  onRequestParsedPreview,
}: PdfAttachmentPreviewDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto flex max-h-[90vh] w-full max-w-4xl flex-col border border-border-default bg-surface-default shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm font-semibold text-text-default">
                {attachmentPreview?.title ?? parsedPreview?.title ?? "PDF Preview"}
              </DialogTitle>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onActivePreviewTabChange("pdf");
                  }}
                  className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                    activePreviewTab === "pdf"
                      ? "bg-action-primary-bg text-white"
                      : "bg-surface-subtle text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onActivePreviewTabChange("parsed");
                    if (
                      attachmentPreview?.documentId &&
                      parsedPreview?.documentId !== attachmentPreview.documentId
                    ) {
                      onRequestParsedPreview(
                        attachmentPreview.documentId,
                        attachmentPreview.title,
                      );
                    }
                  }}
                  className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                    activePreviewTab === "parsed"
                      ? "bg-action-primary-bg text-white"
                      : "bg-surface-subtle text-text-muted hover:bg-surface-hover"
                  }`}
                >
                  Parsed
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={parsedPreviewLoading}
              className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default disabled:opacity-50"
              aria-label="Close parsed content preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-40 max-h-[70vh] overflow-auto p-4">
            {activePreviewTab === "pdf" &&
              (attachmentPreview?.previewUrl ? (
                <iframe
                  src={attachmentPreview.previewUrl}
                  className="h-[68vh] w-full border border-border-subtle bg-surface-subtle"
                  title={`PDF preview for ${attachmentPreview.title}`}
                />
              ) : (
                <div className="border border-border-subtle bg-surface-subtle/40 px-3 py-2 text-sm text-text-muted">
                  Preview is not available for this attachment yet.
                </div>
              ))}

            {activePreviewTab === "parsed" && (
              <>
                {!isParsedReadyStatus(attachmentPreview?.importStatus) && (
                  <div className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    Parsed Docling output is not ready yet. Wait until import status is completed.
                  </div>
                )}

                {isParsedReadyStatus(attachmentPreview?.importStatus) &&
                  parsedPreviewLoading && (
                    <div className="flex items-center gap-2 text-sm text-text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading parsed content...
                    </div>
                  )}

                {isParsedReadyStatus(attachmentPreview?.importStatus) &&
                  !parsedPreviewLoading &&
                  parsedPreviewError && (
                    <div className="border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
                      {parsedPreviewError}
                    </div>
                  )}

                {isParsedReadyStatus(attachmentPreview?.importStatus) &&
                  !parsedPreviewLoading &&
                  !parsedPreviewError &&
                  parsedPreview && (
                    <pre className="whitespace-pre-wrap wrap-break-word border border-border-subtle bg-surface-subtle/40 p-3 text-xs text-text-default">
                      {parsedPreview.markdown}
                    </pre>
                  )}
              </>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
