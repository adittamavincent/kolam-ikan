import { Eye, FileText, Download, ExternalLink, X } from "lucide-react";
import { FileAttachmentThumbnail } from "./FileAttachmentThumbnail";

export interface FileAttachmentViewProps {
  // Common
  keyId: string;
  title: string;
  subtitle?: string | null;
  annotationText?: string | null;
  storagePath?: string | null;
  thumbnailPath?: string | null;
  thumbnailStatus?: string | null;
  documentId?: string | null;
  importStatus?: string | null;
  progressPercent?: number;
  progressMessage?: string | null;
  
  // Conditional UI features
  variant: "creator" | "log";
  
  // Interactivity (for creator mode)
  previewUrl?: string | null;
  isProcessing?: boolean;
  canOpenParsed?: boolean;
  displayMode?: "inline" | "download" | "external";
  
  // Actions
  onPreviewFile?: () => void;
  onPreviewParsed?: () => void;
  onRemove?: () => void;
}

function deriveFileTypeLabel(
  title: string,
  storagePath?: string | null,
  previewUrl?: string | null,
) {
  const candidate = [title, storagePath, previewUrl]
    .find((value) => typeof value === "string" && value.includes("."))
    ?.split(/[?#]/, 1)[0]
    .split("/")
    .pop();

  const extension = candidate?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  return extension || "FILE";
}

function normalizeSubtitle(
  subtitle: string | null | undefined,
  title: string,
  storagePath?: string | null,
  previewUrl?: string | null,
) {
  if (!subtitle) return null;

  const fileTypeLabel = deriveFileTypeLabel(title, storagePath, previewUrl);
  return subtitle.replace(/^File(?=$| • )/i, fileTypeLabel);
}

function FileAttachmentActions({
  title,
  onPreviewFile,
  onPreviewParsed,
  canOpenParsed,
  previewUrl,
  displayMode,
  onRemove,
  showPreviewButtons = false,
}: {
  title: string;
  onPreviewFile?: () => void;
  onPreviewParsed?: () => void;
  canOpenParsed?: boolean;
  previewUrl?: string | null;
  displayMode?: "inline" | "download" | "external";
  onRemove?: () => void;
  showPreviewButtons?: boolean;
}) {
  const shouldShowPreviewFile = showPreviewButtons || !!onPreviewFile;
  const shouldShowPreviewParsed = showPreviewButtons || !!onPreviewParsed;

  if (!shouldShowPreviewFile && !shouldShowPreviewParsed && !previewUrl && !onRemove)
    return null;

  return (
    <div className="flex items-center gap-1">
      {shouldShowPreviewFile && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPreviewFile?.();
          }}
          disabled={!onPreviewFile}
          className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
          aria-label={`Preview ${title}`}
          title={onPreviewFile ? "Open file preview" : "File preview unavailable"}
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
      )}
      
      {shouldShowPreviewParsed && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (canOpenParsed && onPreviewParsed) onPreviewParsed();
          }}
          disabled={!canOpenParsed || !onPreviewParsed}
          className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Open parsed Docling for ${title}`}
          title={
            !onPreviewParsed
              ? "Parsed preview unavailable"
              : canOpenParsed
                ? "Open parsed Docling content"
                : "Parsed content not ready"
          }
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
      )}
      
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
          aria-label="Open file in new tab"
          title="Open in new tab"
        >
          {displayMode === "download" ? (
            <Download className="h-3.5 w-3.5" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" />
          )}
        </a>
      )}
      
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
          aria-label={`Remove ${title}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FileAttachmentItem(props: FileAttachmentViewProps) {
  const {
    title,
    subtitle,
    annotationText,
    storagePath,
    thumbnailPath,
    thumbnailStatus,
    documentId,
    importStatus,
    progressPercent = 0,
    progressMessage,
    variant,
    previewUrl,
    isProcessing,
    canOpenParsed,
    displayMode = "external",
    onPreviewFile,
    onPreviewParsed,
    onRemove,
  } = props;
  const normalizedSubtitle = normalizeSubtitle(
    subtitle,
    title,
    storagePath,
    previewUrl,
  );
  const fileTypeLabel = deriveFileTypeLabel(title, storagePath, previewUrl);
  const overlaySubtitle = normalizedSubtitle || fileTypeLabel;

  if (variant === "log") {
    return (
      <div
        className="group/log-pdf relative h-40 w-28 overflow-hidden border border-border-default bg-surface-elevated transition-colors hover:border-border-strong"
        title={annotationText || subtitle || title}
      >
        <FileAttachmentThumbnail
          url={previewUrl}
          storagePath={storagePath}
          thumbnailPath={thumbnailPath}
          thumbnailStatus={thumbnailStatus}
          documentId={documentId}
          title={title}
          importStatus={importStatus ?? null}
          progressPercent={progressPercent}
          className="h-full w-full border-0"
        />

        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-surface-default via-surface-default/90 to-surface-default/15 opacity-0 transition-opacity duration-150 group-hover/log-pdf:opacity-100" />

        {onRemove && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            className="absolute left-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center border border-border-default bg-surface-default/95 text-text-muted opacity-0 transition-all duration-150 hover:text-text-default group-hover/log-pdf:opacity-100"
            aria-label={`Remove ${title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="absolute inset-x-1.5 bottom-1.5 z-10 flex translate-y-1 flex-col gap-1 opacity-0 transition-all duration-150 group-hover/log-pdf:translate-y-0 group-hover/log-pdf:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPreviewFile?.();
            }}
            disabled={!onPreviewFile}
            className="pointer-events-auto inline-flex h-7 items-center justify-center gap-1.5 border border-border-default bg-surface-default/95 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-default transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-text-subtle"
            aria-label={`Preview ${title}`}
            title={onPreviewFile ? "Open original file preview" : "File preview unavailable"}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Original</span>
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (canOpenParsed && onPreviewParsed) onPreviewParsed();
            }}
            disabled={!canOpenParsed || !onPreviewParsed}
            className="pointer-events-auto inline-flex h-7 items-center justify-center gap-1.5 border border-border-default bg-surface-default/95 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-default transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-text-subtle"
            aria-label={`Open parsed Docling for ${title}`}
            title={
              !onPreviewParsed
                ? "Parsed preview unavailable"
                : canOpenParsed
                  ? "Open parsed Docling content"
                  : "Parsed content not ready"
            }
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Parsed</span>
          </button>
        </div>

        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-1 truncate bg-surface-default/85 px-2 py-1 text-[10px] font-medium text-text-default transition-opacity duration-150 group-hover/log-pdf:opacity-0">
          {title}
        </div>

        {overlaySubtitle && (
          <div className="pointer-events-none absolute inset-x-1.5 bottom-8 z-1 line-clamp-2 bg-surface-default/85 px-2 py-1 text-[10px] text-text-default transition-opacity duration-150 group-hover/log-pdf:opacity-0">
            {overlaySubtitle}
          </div>
        )}
      </div>
    );
  }

  // Creator variant
  return (
    <div
      className="relative overflow-hidden border border-border-default bg-surface-default px-3 py-2 transition-colors cursor-default"
      title={isProcessing ? "Processing Docling..." : "Attachment actions"}
    >
      {/* Progress bar background */}
      {isProcessing && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-primary-950 transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <FileAttachmentThumbnail
              url={previewUrl}
              storagePath={storagePath}
              thumbnailPath={thumbnailPath}
              thumbnailStatus={thumbnailStatus}
              documentId={documentId}
              title={title}
              importStatus={importStatus ?? null}
              progressPercent={progressPercent}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium text-text-default">
                {title}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {subtitle && (
                <div className="text-[11px] text-text-muted">
                  {subtitle}
                </div>
              )}
              {isProcessing && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-action-primary-bg">
                    {progressPercent}%
                  </span>
                  {progressMessage && (
                    <span className="truncate text-[10px] text-text-subtle">
                      {progressMessage}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <FileAttachmentActions
            title={title}
            canOpenParsed={canOpenParsed}
            displayMode={displayMode}
            previewUrl={previewUrl}
            onPreviewFile={onPreviewFile}
            onPreviewParsed={onPreviewParsed}
            onRemove={onRemove}
          />
        </div>
      </div>
    </div>
  );
}
