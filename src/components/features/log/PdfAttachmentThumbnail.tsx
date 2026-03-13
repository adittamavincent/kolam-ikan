"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

interface PdfAttachmentThumbnailProps {
  url?: string | null;
  title: string;
}

export function PdfAttachmentThumbnail({
  url,
  title,
}: PdfAttachmentThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function renderFirstPage() {
      if (!url || !canvasRef.current) {
        setHasRendered(false);
        return;
      }

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

        const loadingTask = pdfjs.getDocument({ url });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        if (canceled || !canvasRef.current) {
          await pdf.destroy();
          return;
        }

        const viewport = page.getViewport({ scale: 0.35 });
        const context = canvasRef.current.getContext("2d");
        if (!context) {
          await pdf.destroy();
          return;
        }

        canvasRef.current.width = viewport.width;
        canvasRef.current.height = viewport.height;

        await page.render({
          canvas: canvasRef.current,
          canvasContext: context,
          viewport,
        }).promise;

        await pdf.destroy();
        if (!canceled) {
          setHasRendered(true);
        }
      } catch {
        if (!canceled) {
          setHasRendered(false);
        }
      }
    }

    void renderFirstPage();

    return () => {
      canceled = true;
    };
  }, [url]);

  return (
    <div className="relative h-16 w-12">
      <canvas
        ref={canvasRef}
        className="h-16 w-12 rounded-sm border border-border-subtle object-cover"
        aria-label={`Thumbnail preview for ${title}`}
      />
      {!hasRendered && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-sm border border-border-subtle bg-surface-subtle"
          aria-label={`PDF thumbnail unavailable for ${title}`}
        >
          <FileText className="h-4 w-4 text-text-muted" />
        </div>
      )}
    </div>
  );
}
