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
}

function isLikelyImageUrl(url: string) {
  return (
    url.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|gif|bmp|avif|tiff)(\?.*)?$/i.test(url)
  );
}

function isLikelyPdfUrl(url: string, title?: string) {
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
}: FileAttachmentThumbnailProps) {
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const { thumbnailPath: ensuredThumbnailPath, thumbnailStatus: ensuredStatus } = useEnsureThumbnail({
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
    if (pdfPreviewUrl) return pdfPreviewUrl;
    return url ?? null;
  }, [resolvedThumbnailUrl, pdfPreviewUrl, url]);

  useEffect(() => {
    setImageFailed(false);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!url || resolvedThumbnailUrl || !isLikelyPdfUrl(url, title) || !url.startsWith("blob:")) {
      setPdfPreviewUrl(null);
      return () => {
        cancelled = true;
      };
    }

    const renderPdfPreview = async () => {
      try {
        const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf");
        // `pdfjs-dist` exposes complex types we don't need to fully model here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjs = (pdfjsModule.default || pdfjsModule) as unknown as any;

        const response = await fetch(url);
        const data = await response.arrayBuffer();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadingTask = (pdfjs as any).getDocument({ data, disableWorker: true } as any);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

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

        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
        const dataUrl = canvas.toDataURL("image/png");

        if (!cancelled) {
          setPdfPreviewUrl(dataUrl);
        }

        if (typeof pdf.destroy === "function") {
          await pdf.destroy();
        }
      } catch {
        if (!cancelled) {
          setPdfPreviewUrl(null);
        }
      }
    };

    void renderPdfPreview();

    return () => {
      cancelled = true;
    };
  }, [resolvedThumbnailUrl, title, url]);

  const previewKind = useMemo<"image" | "none">(() => {
    if (resolvedThumbnailUrl) return "image";
    if (pdfPreviewUrl) return "image";
    if (url && isLikelyImageUrl(url)) return "image";
    return "none";
  }, [resolvedThumbnailUrl, pdfPreviewUrl, url]);

  const effectivePreviewUrl = previewKind === "none" ? null : previewUrl;
  const hasPreview = previewKind === "image" && !!effectivePreviewUrl && !imageFailed;

  const showQueued =
    importStatus === "queued" ||
    effectiveThumbnailStatus === "pending";

  const showProcessing =
    importStatus === "processing" ||
    importStatus === "uploading" ||
    effectiveThumbnailStatus === "processing";

  const showError =
    importStatus === "failed" ||
    importStatus === "error" ||
    effectiveThumbnailStatus === "failed";

  const showPlaceholder = previewKind === "none" || imageFailed;
  const showOverlay = showError || showProcessing || showQueued || showPlaceholder;
  const overlayBg = hasPreview ? "bg-black/25" : "bg-surface-subtle";

  return (
    <div className="relative h-16 w-12 overflow-hidden border border-border-default bg-surface-subtle">
      {previewKind === "image" && effectivePreviewUrl && !imageFailed && (
        <Image
          src={effectivePreviewUrl}
          alt={`Thumbnail preview for ${title}`}
          width={48}
          height={64}
          className="object-cover"
          onError={() => setImageFailed(true)}
        />
      )}

      {showOverlay && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center ${overlayBg}`}
        >
          {showError ? (
            <div className="flex flex-col items-center gap-1">
              <div className="bg-rose-600/90 p-1 text-white">
                <X className="h-4 w-4" />
              </div>
              <div className="text-[10px] font-semibold text-rose-600">Failed</div>
            </div>
          ) : showProcessing || showQueued ? (
            <div className="flex flex-col items-center gap-1">
              {typeof progressPercent === "number" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-action-primary-bg" />
                  <div className="text-[10px] font-semibold text-text-default">
                    {progressPercent}%
                  </div>
                </>
              ) : (
                <div className="text-[10px] font-medium text-text-default">
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
        <div className="absolute right-0 top-0 m-1 bg-green-500/90 p-0.5 text-white">
          <Check className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
