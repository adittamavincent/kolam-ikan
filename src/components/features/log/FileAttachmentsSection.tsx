import type { DragEventHandler, ReactNode } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import {
  FileAttachmentItem,
  type FileAttachmentViewProps,
} from "./FileAttachmentItem";

export type FileAttachmentsSectionItem = FileAttachmentViewProps;

interface FileAttachmentsSectionProps {
  items: FileAttachmentsSectionItem[];
  canUpload?: boolean;
  isUploading?: boolean;
  isDragOver?: boolean;
  uploadLabel?: string;
  emptyStateMessage: string;
  onUploadFiles?: (files: FileList | File[]) => Promise<void> | void;
  onOpenLibrary?: () => void;
  onDragEnter?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  notes?: ReactNode;
}

export function FileAttachmentsSection({
  items,
  canUpload = false,
  isUploading = false,
  isDragOver = false,
  uploadLabel = "Upload File",
  emptyStateMessage,
  onUploadFiles,
  onOpenLibrary,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  notes,
}: FileAttachmentsSectionProps) {
  const hasItems = items.length > 0;

  return (
    <div className="space-y-2">
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 border border-border-default bg-surface-subtle px-2 py-1 text-xs font-medium text-text-default transition-colors hover:bg-surface-default">
            <Upload className="h-3 w-3" />
            {uploadLabel}
            <input
              type="file"
              accept="*/*"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = event.target.files;
                event.target.value = "";
                if (!files || files.length === 0) return;
                await onUploadFiles?.(files);
              }}
            />
          </label>

          {onOpenLibrary && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 border border-border-default bg-surface-subtle px-2 py-1 text-xs font-medium text-text-default transition-colors hover:bg-surface-default"
              onClick={onOpenLibrary}
            >
              <FileText className="h-3 w-3" />
              Select from Library
            </button>
          )}

          {isUploading && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading files...
            </span>
          )}
        </div>
      )}

      <div
        className={`rounded-sm border transition-colors ${
          canUpload
            ? isDragOver
              ? "border-action-primary-bg bg-primary-950"
              : hasItems
                ? "border-transparent"
                : "border-dashed border-border-default bg-surface-subtle"
            : "border-transparent"
        }`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {hasItems ? (
          <div className="flex flex-wrap gap-2 p-1">
            {items.map((item) => (
              <FileAttachmentItem key={item.keyId} {...item} />
            ))}
          </div>
        ) : (
          <div className="px-2 py-3 text-center text-xs text-text-muted">
            {emptyStateMessage}
          </div>
        )}
      </div>

      {notes}
    </div>
  );
}
