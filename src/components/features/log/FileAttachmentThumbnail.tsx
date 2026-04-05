"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { FileText, X, Loader2, Check } from "lucide-react";
import { useEnsureThumbnail } from "@/lib/hooks/useEnsureThumbnail";

interface FileAttachmentThumbnailProps {
  url?: string | null;
  storagePath?: string | null;
  thumbnailPath?: string | null;
  thumbnailStatus?: string | null;
  documentId?: string | null;
  title: string;
  importStatus?: string | null;
  progressPercent?: number | null;
  className?: string;
  imageClassName?: string;
}

interface PdfViewportLike {
  width: number;
  height: number;
}

interface PdfPageLike {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewportLike;
  }) => { promise: Promise<void> };
}

interface PdfDocumentLike {
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy?: () => Promise<void> | void;
}

interface PdfJsLike {
  getDocument: (options: { data: ArrayBuffer; disableWorker: boolean }) => {
    promise: Promise<PdfDocumentLike>;
  };
}

function isLikelyImageUrl(url: string, title?: string) {
  if (url.startsWith("blob:")) {
    return Boolean(title?.match(/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)$/i));
  }
  return (
    url.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg)(\?.*)?$/i.test(url)
  );
}

function isPdf(url: string, title?: string) {
  if (url.startsWith("blob:")) {
    return Boolean(title?.toLowerCase().endsWith(".pdf"));
  }
  return /\.pdf(\?.*)?$/i.test(url);
}

export function FileAttachmentThumbnail({
  url,
  thumbnailPath,
  thumbnailStatus,
  documentId,
  title,
  importStatus = null,
  progressPercent = null,
  className,
  imageClassName,
}: FileAttachmentThumbnailProps) {
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const {
    thumbnailPath: ensuredThumbnailPath,
    thumbnailStatus: ensuredStatus,
  } = useEnsureThumbnail({
    documentId: documentId ?? undefined,
    importStatus,
    thumbnailPath,
    thumbnailStatus,
  });

  const effectiveThumbnailPath = ensuredThumbnailPath ?? thumbnailPath ?? null;
  const effectiveThumbnailStatus = ensuredStatus ?? thumbnailStatus ?? null;

  const resolvedThumbnailUrl = useMemo(() => {
    if (!effectiveThumbnailPath) return null;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return null;
    const encodedPath = effectiveThumbnailPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${base.replace(/\/$/, "")}/storage/v1/object/public/thumbnails/${encodedPath}`;
  }, [effectiveThumbnailPath]);

  const previewUrl = useMemo(() => {
    if (resolvedThumbnailUrl) return resolvedThumbnailUrl;
    if (filePreviewUrl) return filePreviewUrl;
    return url ?? null;
  }, [resolvedThumbnailUrl, filePreviewUrl, url]);

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;

    if (
      !url ||
      resolvedThumbnailUrl ||
      !isPdf(url, title) ||
      !url.startsWith("blob:")
    ) {
      setFilePreviewUrl(null);
      return () => {
        cancelled = true;
      };
    }

    const generatePreview = async () => {
      try {
        const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf");
        const pdfjs = (pdfjsModule.default || pdfjsModule) as PdfJsLike;

        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const loadingTask = pdfjs.getDocument({
          data,
          disableWorker: true,
        });
        const doc = await loadingTask.promise;
        const page = await doc.getPage(1);

        const viewport = page.getViewport({ scale: 1 });
        const maxWidth = 96;
        const maxHeight = 128;
        const scale = Math.min(
          maxWidth / viewport.width,
          maxHeight / viewport.height,
          2,
        );
        const scaledViewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(scaledViewport.width);
        canvas.height = Math.round(scaledViewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport: scaledViewport })
          .promise;
        const dataUrl = canvas.toDataURL("image/png");

        if (!cancelled) {
          setFilePreviewUrl(dataUrl);
        }

        if (typeof doc.destroy === "function") {
          await doc.destroy();
        }
      } catch {
        if (!cancelled) {
          setFilePreviewUrl(null);
        }
      }
    };

    void generatePreview();

    return () => {
      cancelled = true;
    };
  }, [resolvedThumbnailUrl, title, url]);

  const previewKind = useMemo<"image" | "none">(() => {
    if (resolvedThumbnailUrl) return "image";
    if (filePreviewUrl) return "image";
    if (url && isLikelyImageUrl(url, title)) return "image";
    return "none";
  }, [resolvedThumbnailUrl, filePreviewUrl, title, url]);

  const effectivePreviewUrl = previewKind === "none" ? null : previewUrl;
  const hasPreview =
    previewKind === "image" && !!effectivePreviewUrl && !imageFailed;

  const showQueued =
    importStatus === "queued" || effectiveThumbnailStatus === "pending";

  const showProcessing =
    importStatus === "processing" ||
    importStatus === "uploading" ||
    effectiveThumbnailStatus === "processing";

  const showError =
    importStatus === "failed" ||
    importStatus === "error" ||
    effectiveThumbnailStatus === "failed";

  const showPlaceholder = previewKind === "none" || imageFailed;
  const showOverlay =
    showError || showProcessing || showQueued || showPlaceholder;
  const overlayBg = hasPreview ? "bg-overlay-backdrop" : "bg-surface-subtle";

  return (
    <div
      className={`relative overflow-hidden border border-border-default bg-surface-subtle ${className ?? "h-16 w-12"}`}
    >
      {previewKind === "image" && effectivePreviewUrl && !imageFailed && (
        <Image
          src={effectivePreviewUrl}
          alt={`Thumbnail preview for ${title}`}
          fill
          sizes="160px"
          className={`object-contain ${imageClassName ?? ""}`}
          unoptimized
          onError={() => setImageFailed(true)}
        />
      )}

      {showOverlay && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center ${overlayBg}`}
        >
          {showError ? (
            <div className="flex flex-col items-center gap-1">
              <div className="bg-status-error-bg p-1 text-status-error-text">
                <X className="h-4 w-4" />
              </div>
              <div className="text-status-error-text">
                Failed
              </div>
            </div>
          ) : showProcessing || showQueued ? (
            <div className="flex flex-col items-center gap-1">
              {typeof progressPercent === "number" ? (
                <>
                  <Loader2 className="log-pane__accent-label h-4 w-4 animate-spin" />
                  <div className="text-text-default">
                    {progressPercent}%
                  </div>
                </>
              ) : (
                <div className="text-text-default">
                  {showQueued ? "Queued" : "Processing"}
                </div>
              )}
            </div>
          ) : (
            <FileText className="h-4 w-4 text-text-muted" />
          )}
        </div>
      )}

      {(importStatus === "completed" || importStatus === "done") && (
        <div className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center border border-status-success-border bg-status-success-bg text-status-success-text">
          <Check className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
