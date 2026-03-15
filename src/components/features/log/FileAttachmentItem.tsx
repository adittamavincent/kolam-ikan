import { Eye, FileText, Download, ExternalLink, X, Loader2 } from "lucide-react";
import { FileAttachmentThumbnail } from "./FileAttachmentThumbnail";

export interface FileAttachmentViewProps {
  // Common
  keyId: string;
  title: string;
  subtitle?: string | null;
  annotationText?: string | null;
  storagePath?: string | null;
  thumbnailPath?: string | null;
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
  onPreviewPdf?: () => void;
  onPreviewParsed?: () => void;
  onRemove?: () => void;
}

function PdfAttachmentActions({
  title,
  onPreviewPdf,
  onPreviewParsed,
  canOpenParsed,
  previewUrl,
  displayMode,
  onRemove,
  showPreviewButtons = false,
}: {
  title: string;
  onPreviewPdf?: () => void;
  onPreviewParsed?: () => void;
  canOpenParsed?: boolean;
  previewUrl?: string | null;
  displayMode?: "inline" | "download" | "external";
  onRemove?: () => void;
  showPreviewButtons?: boolean;
}) {
  const shouldShowPreviewPdf = showPreviewButtons || !!onPreviewPdf;
  const shouldShowPreviewParsed = showPreviewButtons || !!onPreviewParsed;

  if (!shouldShowPreviewPdf && !shouldShowPreviewParsed && !previewUrl && !onRemove)
    return null;

  return (
    <div className="flex items-center gap-1">
      {shouldShowPreviewPdf && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPreviewPdf?.();
          }}
          disabled={!onPreviewPdf}
          className="p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
          aria-label={`Preview ${title}`}
          title={onPreviewPdf ? "Open PDF preview" : "PDF preview unavailable"}
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
          aria-label="Open PDF in new tab"
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
    importStatus,
    progressPercent = 0,
    progressMessage,
    variant,
    previewUrl,
    isProcessing,
    canOpenParsed,
    displayMode = "external",
    onPreviewPdf,
    onPreviewParsed,
    onRemove,
  } = props;

  if (variant === "log") {
    return (
      <div className="group/log-pdf flex items-start justify-between gap-3 border border-border-default bg-surface-subtle/40 px-2 py-1.5 transition-colors hover:bg-surface-subtle/60">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <FileAttachmentThumbnail
            url={previewUrl}
            storagePath={storagePath}
            thumbnailPath={thumbnailPath}
            title={title}
            importStatus={importStatus ?? null}
            progressPercent={progressPercent}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-text-default">
              {title}
            </div>
            {annotationText && (
              <div className="text-[11px] text-text-muted">
                {annotationText}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <PdfAttachmentActions
            title={title}
            canOpenParsed={canOpenParsed}
            displayMode={displayMode}
            previewUrl={previewUrl}
            onPreviewPdf={onPreviewPdf}
            onPreviewParsed={onPreviewParsed}
            onRemove={onRemove}
            showPreviewButtons
          />
        </div>
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
          className="absolute bottom-0 left-0 h-0.5 bg-action-primary-bg/30 transition-all duration-500 ease-out"
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
              title={title}
              importStatus={importStatus ?? null}
              progressPercent={progressPercent}
            />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/5 backdrop-blur-[1px]">
                <Loader2 className="h-4 w-4 animate-spin text-action-primary-bg" />
              </div>
            )}
          </div>
          <div>
            <div className="text-xs font-medium text-text-default">
              {title}
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
          <PdfAttachmentActions
            title={title}
            canOpenParsed={canOpenParsed}
            displayMode={displayMode}
            previewUrl={previewUrl}
            onPreviewPdf={onPreviewPdf}
            onPreviewParsed={onPreviewParsed}
            onRemove={onRemove}
          />
        </div>
      </div>
    </div>
  );
}
