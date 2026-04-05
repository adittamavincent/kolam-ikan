import { useRef, type DragEventHandler, type ReactNode } from "react";
import { FileText, Upload } from "lucide-react";
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
  isDragOver = false,
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openFilePicker = () => {
    if (!canUpload) return;
    inputRef.current?.click();
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await onUploadFiles?.(files);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={async (event) => {
          const files = event.target.files;
          event.target.value = "";
          await handleFilesSelected(files);
        }}
      />

      <div
        className={`rounded-none border transition-colors ${
          canUpload
            ? isDragOver
              ? ""
              : hasItems
                ? "border-border-default"
                : "border-dashed border-border-default bg-surface-subtle"
            : "border-border-default"
        }`}
        style={
          canUpload && isDragOver
            ? {
                borderColor: "var(--color-primary-500)",
                backgroundColor: "var(--color-primary-100)",
              }
            : undefined
        }
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => {
          if (!canUpload || hasItems) return;
          openFilePicker();
        }}
        role={canUpload && !hasItems ? "button" : undefined}
        tabIndex={canUpload && !hasItems ? 0 : undefined}
        onKeyDown={(event) => {
          if (!canUpload || hasItems) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openFilePicker();
          }
        }}
      >
        {hasItems ? (
          <div className="flex flex-wrap gap-2 p-1">
            {items.map((item) => (
              <FileAttachmentItem key={item.keyId} {...item} />
            ))}
          </div>
        ) : (
          <div className="relative flex h-12 items-center justify-center gap-2 text-text-muted">
            {canUpload ? <Upload className="h-4 w-4" /> : null}
            <span>{emptyStateMessage}</span>

            {canUpload ? (
              <div
                className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-subtle opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100"
                onClick={() => {
                  openFilePicker();
                }}
              >
                {onOpenLibrary ? (
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 border border-border-default bg-surface-default px-2 uppercase tracking-[0.12em] text-text-default transition-colors hover:bg-surface-hover"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenLibrary();
                    }}
                  >
                    <FileText className="h-4 w-4" />
                    Library
                  </button>
                ) : null}

                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 border border-border-default bg-surface-default px-2 uppercase tracking-[0.12em] text-text-default transition-colors hover:bg-surface-hover"
                  onClick={(event) => {
                    event.stopPropagation();
                    openFilePicker();
                  }}
                >
                  <Upload className="h-4 w-4" />
                  Device
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {notes}
    </div>
  );
}
