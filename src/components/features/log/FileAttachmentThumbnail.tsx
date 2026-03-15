"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, X, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const promiseConstructor = Promise as unknown as {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

if (!promiseConstructor.withResolvers) {
  promiseConstructor.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

interface FileAttachmentThumbnailProps {
  url?: string | null;
  storagePath?: string | null;
  thumbnailPath?: string | null;
  title: string;
  importStatus?: string | null;
  progressPercent?: number | null;
}

export function FileAttachmentThumbnail({
  url,
  storagePath,
  thumbnailPath,
  title,
  importStatus = null,
  progressPercent = null,
}: FileAttachmentThumbnailProps) {
  type PDFPageLike = {
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<void> };
  };

  type PDFDocumentLike = {
    getPage: (n: number) => Promise<PDFPageLike>;
    destroy?: () => Promise<void>;
  };

  type PdfJsModule = {
    version?: string;
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: {
      data?: Uint8Array;
      url?: string;
      useWorkerFetch?: boolean;
      isEvalSupported?: boolean;
    }) => { promise: Promise<PDFDocumentLike> };
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fetchedStoragePathRef = useRef<string | null>(null);
  const renderAttemptsRef = useRef(0);
  const [hasRendered, setHasRendered] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(url || null);
  const [isFromCache, setIsFromCache] = useState(false);
  const [skipThumbnail, setSkipThumbnail] = useState(false);

  useEffect(() => {
    // When the prop 'url' changes, we want to reset to it.
    // We also clear the fetched storage path since we're prioritizing the new url.
    fetchedStoragePathRef.current = null;
    renderAttemptsRef.current = 0;
    setResolvedUrl(url || null);
    setIsFromCache(false);
    setSkipThumbnail(false);
  }, [url]);

  useEffect(() => {
    // When the resolved URL changes (either because we fetched a new signed URL,
    // or because `url` prop changed), reset the render attempt counter so we can
    // retry once in case of transient failures.
    renderAttemptsRef.current = 0;
  }, [resolvedUrl]);

  useEffect(() => {
    // When storagePath changes, we may need to retry thumbnail generation.
    // Reset the internal cache tracking so we re-run the fetch logic.
    fetchedStoragePathRef.current = null;
    setSkipThumbnail(false);
  }, [storagePath, thumbnailPath]);

  useEffect(() => {
    // We don't fetch if:
    // 1. No storagePath is provided AND no thumbnailPath is provided
    if (!storagePath && !thumbnailPath) return;
    // 2. We have a prop `url` AND it is currently active (resolvedUrl === url)
    // BUT only skip if we don't have a storagePath or thumbnailPath (because
    // if we have either, we want to check for thumbnails first). However,
    // when the import is queued/processing we should still attempt to check
    // for thumbnails since they may appear while queued.
    if (
      url &&
      resolvedUrl === url &&
      !storagePath &&
      !thumbnailPath &&
      !["queued", "processing"].includes(importStatus ?? "")
    )
      return;
    // 3. We ALREADY fetched a signed URL for this exact storagePath/thumbnailPath and we haven't cleared it
    if (
      resolvedUrl &&
      (fetchedStoragePathRef.current === storagePath ||
        fetchedStoragePathRef.current === thumbnailPath)
    )
      return;

    const supabase = createClient();
    let canceled = false;

    async function getSignedUrl() {
      try {
        // Step 1: Try server-generated thumbnail first if thumbnailPath is provided
        if (thumbnailPath && !skipThumbnail) {
          if (process.env.NODE_ENV !== "production")
            console.debug(
              "FileAttachmentThumbnail: checking for server-generated thumbnail",
              thumbnailPath,
            );
          const { data: thumbData } = supabase.storage
            .from("thumbnails")
            .getPublicUrl(thumbnailPath);

          if (!canceled && thumbData?.publicUrl) {
            // Verify the thumbnail actually exists (some buckets may return a
            // public URL even if the object isn't present). Use HEAD to avoid
            // downloading the asset.
            try {
              const headResp = await fetch(thumbData.publicUrl, { method: "HEAD" });
              if (headResp.ok) {
                if (process.env.NODE_ENV !== "production")
                  console.debug(
                    "FileAttachmentThumbnail: found server-generated thumbnail",
                    thumbData.publicUrl,
                  );
                fetchedStoragePathRef.current = thumbnailPath;
                setResolvedUrl(thumbData.publicUrl);
                setIsFromCache(true);
                return;
              }
            } catch (e) {
              // If HEAD fails (CORS/unsupported), fall back to attempting GET in next phase.
              if (process.env.NODE_ENV !== "production")
                console.debug(
                  "FileAttachmentThumbnail: HEAD check failed for thumbnail",
                  thumbData.publicUrl,
                  e,
                );
            }
          }
        }

        // Step 2: Try legacy cached thumbnail (storagePath.png) if storagePath is provided
        if (storagePath && !skipThumbnail) {
          if (process.env.NODE_ENV !== "production")
            console.debug(
              "FileAttachmentThumbnail: checking for legacy cached thumbnail",
              storagePath,
            );
          const thumbPath = `${storagePath}.png`;
          const { data: thumbData } = supabase.storage
            .from("thumbnails")
            .getPublicUrl(thumbPath);

          if (!canceled && thumbData?.publicUrl) {
            try {
              const headResp = await fetch(thumbData.publicUrl, { method: "HEAD" });
              if (headResp.ok) {
                if (process.env.NODE_ENV !== "production")
                  console.debug(
                    "FileAttachmentThumbnail: found legacy cached thumbnail",
                    thumbData.publicUrl,
                  );
                fetchedStoragePathRef.current = storagePath;
                setResolvedUrl(thumbData.publicUrl);
                setIsFromCache(true);
                return;
              }
            } catch (e) {
              if (process.env.NODE_ENV !== "production")
                console.debug(
                  "FileAttachmentThumbnail: HEAD check failed for legacy thumbnail",
                  thumbData.publicUrl,
                  e,
                );
            }
          }
        } else {
          console.debug(
            "FileAttachmentThumbnail: skipping cached thumbnail fetch (previously failed)",
            { storagePath, thumbnailPath },
          );
        }

        // Step 3: Fallback to the original PDF if no thumbnail exists or we skipped it
        if (storagePath) {
          console.debug(
            "FileAttachmentThumbnail: falling back to original PDF",
            storagePath,
          );
          const bucket = "document-files";
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrl(storagePath, 60 * 60);

          if (error) {
            console.warn(
              `PDF object not found or error in storage: ${storagePath}`,
              error,
            );
            if (!canceled) setHasRendered(false);
            return;
          }

          if (!canceled && data?.signedUrl) {
            console.debug(
              "FileAttachmentThumbnail: obtained fresh signedUrl for PDF",
              data.signedUrl,
            );
            fetchedStoragePathRef.current = storagePath;
            setResolvedUrl(data.signedUrl);
            setIsFromCache(false);
            setSkipThumbnail(false);
          }
        }
      } catch (err) {
        console.error("Error in getSignedUrl for PDF thumbnail:", err, {
          storagePath,
          thumbnailPath,
        });
        if (!canceled) setHasRendered(false);
      }
    }

    void getSignedUrl();
    return () => {
      canceled = true;
    };
  }, [url, storagePath, thumbnailPath, resolvedUrl, skipThumbnail, importStatus]);

  // When importStatus updates, clear cached fetch state so we re-attempt
  // thumbnail/signed URL resolution. This helps when a thumbnail or file
  // appears after the import job progresses (queued -> processing -> done).
  useEffect(() => {
    // Only trigger a recheck when importStatus is meaningful
    if (!importStatus) return;

    // Keep local blob previews intact while upload metadata has not been
    // persisted yet (e.g. WhatsApp import step 4 pending state).
    if (!storagePath && !thumbnailPath) return;

    fetchedStoragePathRef.current = null;
    renderAttemptsRef.current = 0;
    setIsFromCache(false);
    setSkipThumbnail(false);
    // Clear resolvedUrl to force the getSignedUrl effect to run
    setResolvedUrl(null);
  }, [importStatus, storagePath, thumbnailPath]);

  useEffect(() => {
    let canceled = false;

    async function renderFirstPage() {
      if (process.env.NODE_ENV !== "production")
        console.debug("FileAttachmentThumbnail: renderFirstPage start", {
          resolvedUrl,
          storagePath,
        });

      if (!resolvedUrl || !canvasRef.current) {
        setHasRendered(false);
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          if (ctx) {
            // Note: Use the internal canvas size, not the CSS size, to fully clear it
            ctx.clearRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height,
            );
          }
        }
        return;
      }

      try {
        // If the resolved URL points to an image (preview cover OR cached thumbnail), draw it to the canvas
        const isImage =
          /\.(png|jpe?g|webp|gif|bmp|avif)(\?.*)?$/i.test(resolvedUrl) ||
          resolvedUrl.startsWith("data:image/");
        if (isImage || isFromCache) {
          if (process.env.NODE_ENV !== "production")
            console.debug("FileAttachmentThumbnail: drawing image/thumbnail", {
              resolvedUrl,
              isFromCache,
            });
          const img = new Image();
          img.crossOrigin = "anonymous";
          const imgLoad = new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (e) => {
              console.warn("FileAttachmentThumbnail: image failed to load", {
                resolvedUrl,
                error: e,
              });
              reject(new Error("Failed to load image"));
            };
          });
          img.src = resolvedUrl;

          try {
            await imgLoad;
          } catch (loadErr) {
            // If the thumbnail failed to load, fall back to PDF rendering if we have a storagePath
            if (isFromCache && storagePath && !canceled) {
              console.warn(
                "FileAttachmentThumbnail: cached thumbnail failed to load, falling back to PDF rendering",
              );
              setIsFromCache(false);
              setSkipThumbnail(true);
              setResolvedUrl(null); // This will trigger a fresh fetch from document-files in the other effect
              return;
            }
            throw loadErr;
          }

          if (canceled || !canvasRef.current) return;

          const canvas = canvasRef.current;
          const dpr =
            typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
          const cssW = 48;
          const cssH = 64;
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          canvas.style.width = `${cssW}px`;
          canvas.style.height = `${cssH}px`;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.drawImage(img, 0, 0, cssW, cssH);
          ctx.restore();

          if (!canceled) {
            setHasRendered(true);
          }
          return;
        }

        // Import pdfjs-dist dynamically
        let pdfjsModule;
        try {
          pdfjsModule = await import("pdfjs-dist");
        } catch (importErr) {
          console.warn(
            "FileAttachmentThumbnail: failed to import pdfjs-dist",
            importErr,
          );
          throw importErr;
        }

        const pdfjs = (pdfjsModule.default ||
          pdfjsModule) as unknown as PdfJsModule;
        const version = pdfjs.version || "5.5.207";

        // Prioritize local worker as it's most reliable for the current environment.
        // Use an absolute URL to avoid basePath/CSP issues in some deployments.
        const localWorkerUrl =
          typeof window !== "undefined"
            ? new URL(
                "/js/pdf.worker.min.mjs",
                window.location.origin,
              ).toString()
            : "/js/pdf.worker.min.mjs";
        pdfjs.GlobalWorkerOptions.workerSrc = localWorkerUrl;

        if (process.env.NODE_ENV !== "production")
          console.debug("FileAttachmentThumbnail: loading PDF", {
            resolvedUrl,
            version,
            workerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
          });

        // Fetch the PDF content
        const resp = await fetch(resolvedUrl);
        if (!resp.ok) {
          const bodyText = await resp
            .text()
            .catch(() => "<unreadable response>");
          throw new Error(
            `Failed to fetch PDF (status=${resp.status} ${resp.statusText}) ${
              bodyText ? `body=${bodyText.substring(0, 200)}` : ""
            }`,
          );
        }

        const arrayBuffer = await resp.arrayBuffer();
        if (process.env.NODE_ENV !== "production")
          console.debug(
            "FileAttachmentThumbnail: PDF bytes fetched",
            arrayBuffer.byteLength,
          );

        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(arrayBuffer),
          useWorkerFetch: false,
          isEvalSupported: false,
        });

        let pdf;
        try {
          pdf = await loadingTask.promise;
        } catch (loadErr) {
          console.warn(
            "FileAttachmentThumbnail: getDocument failed with worker. Retrying without worker...",
            loadErr,
          );

          try {
            // Fallback for contexts where worker bootstrapping is flaky.
            const noWorkerTask = pdfjs.getDocument({
              data: new Uint8Array(arrayBuffer),
              useWorkerFetch: false,
              isEvalSupported: false,
              disableWorker: true,
            } as unknown as {
              data?: Uint8Array;
              url?: string;
              useWorkerFetch?: boolean;
              isEvalSupported?: boolean;
            });
            pdf = await noWorkerTask.promise;
          } catch (noWorkerErr) {
            console.warn(
              "FileAttachmentThumbnail: no-worker retry failed. Retrying with unpkg worker...",
              noWorkerErr,
            );
            // Final retry with unpkg worker if local worker and no-worker mode fail.
            const unpkgWorkerUrl = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
            pdfjs.GlobalWorkerOptions.workerSrc = unpkgWorkerUrl;
            const retryTask = pdfjs.getDocument({
              data: new Uint8Array(arrayBuffer),
              useWorkerFetch: false,
              isEvalSupported: false,
            });
            pdf = await retryTask.promise;
          }
        }

        const pdfDoc = pdf as unknown as PDFDocumentLike;
        if (process.env.NODE_ENV !== "production")
          console.debug("FileAttachmentThumbnail: PDF document loaded");

        const page = await pdfDoc.getPage(1);
        if (process.env.NODE_ENV !== "production")
          console.debug("FileAttachmentThumbnail: first page retrieved");

        if (canceled || !canvasRef.current) {
          if (typeof pdfDoc.destroy === "function") await pdfDoc.destroy();
          return;
        }

        // compute a viewport that fits exactly into our 48x64 container
        const canvas = canvasRef.current;
        const dpr =
          typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const cssW = 48;
        const cssH = 64;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          cssW / unscaledViewport.width,
          cssH / unscaledViewport.height,
        );
        const viewport = page.getViewport({ scale });

        // Set backing store size (resolution)
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;

        const context = canvas.getContext("2d");
        if (!context) {
          if (typeof pdfDoc.destroy === "function") await pdfDoc.destroy();
          return;
        }

        // Clear canvas and draw a white background first (PDFs often have transparent backgrounds)
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.save();
        context.scale(dpr, dpr);

        // Center the thumbnail if it doesn't fill the entire bucket
        const offsetX = (cssW - viewport.width) / 2;
        const offsetY = (cssH - viewport.height) / 2;
        context.translate(offsetX, offsetY);

        if (process.env.NODE_ENV !== "production")
          console.debug("FileAttachmentThumbnail: rendering page to canvas...", {
            scale,
            viewportWidth: viewport.width,
            viewportHeight: viewport.height,
          });
        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        context.restore();
        if (process.env.NODE_ENV !== "production")
          console.debug("FileAttachmentThumbnail: render complete");

        if (typeof pdfDoc.destroy === "function") await pdfDoc.destroy();
        if (!canceled) {
          setHasRendered(true);

          // FUTURE PROOF: If we just successfully rendered a PDF (not from cache),
          // upload the thumbnail to the storage cache for next time.
          if (storagePath && !isFromCache) {
            if (process.env.NODE_ENV !== "production")
              console.debug(
                "FileAttachmentThumbnail: auto-uploading rendered thumbnail to cache",
                storagePath,
              );
            canvas.toBlob(async (blob) => {
              if (!blob) return;
              try {
                const formData = new FormData();
                formData.append("file", blob, "thumbnail.png");
                formData.append("storagePath", storagePath);

                const uploadResp = await fetch(
                  "/api/documents/thumbnails/upload",
                  {
                    method: "POST",
                    body: formData,
                  },
                );

                if (uploadResp.ok) {
                  if (process.env.NODE_ENV !== "production")
                    console.debug(
                      "FileAttachmentThumbnail: Successfully cached thumbnail for",
                      storagePath,
                    );
                } else {
                  console.warn(
                    "FileAttachmentThumbnail: Failed to cache thumbnail",
                    await uploadResp.text(),
                  );
                }
              } catch (uploadErr) {
                console.warn(
                  "FileAttachmentThumbnail: Error uploading thumbnail to cache",
                  uploadErr,
                );
              }
            }, "image/png");
          }
        }
      } catch (err) {
        if (!canceled) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "Unknown preview error";

          const errorDetails = {
            resolvedUrl,
            storagePath,
            thumbnailPath,
            renderAttempts: renderAttemptsRef.current,
            error: errorMessage,
            stack: err instanceof Error ? err.stack : undefined,
          };

          // Preview rendering can fail for transient signed URLs or unsupported files.
          // Keep this non-fatal and avoid surfacing noisy console errors.
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "FileAttachmentThumbnail: preview fallback",
              errorDetails,
            );
          }

          // Retry once on transient failure (e.g. PDF worker failure or signed URL hiccup).
          // This prevents the component from getting stuck in a state where it never
          // attempts to load the thumbnail/PDF again.
          if (storagePath && renderAttemptsRef.current < 1) {
            renderAttemptsRef.current += 1;
            fetchedStoragePathRef.current = null; // allow refetch
            setResolvedUrl(null);
            return;
          }

          setHasRendered(false);

          // If we have a storagePath and the current resolvedUrl (which might be the prop URL) failed,
          // clear it to trigger a fresh signed URL fetch on the next attempt.
          if (storagePath && resolvedUrl === url) {
            if (process.env.NODE_ENV !== "production")
              console.debug(
                "FileAttachmentThumbnail: prop URL failed, triggering fresh signed URL fetch from storagePath",
              );
            fetchedStoragePathRef.current = null; // Ensure we allow a re-fetch
            setResolvedUrl(null);
          }

          // Ensure canvas is cleared on error
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              ctx.clearRect(
                0,
                0,
                canvasRef.current.width,
                canvasRef.current.height,
              );
            }
          }
        }
      }
    }

    void renderFirstPage();

    return () => {
      canceled = true;
    };
  }, [resolvedUrl, storagePath, thumbnailPath, isFromCache, url]);

  return (
    <div className="relative h-16 w-12 overflow-hidden  border border-border-default bg-surface-subtle">
      <canvas
        ref={canvasRef}
        className="h-16 w-12 object-cover"
        aria-label={`Thumbnail preview for ${title}`}
      />
      {/* Informative overlays based on import status / render result */}
      {!hasRendered && !(importStatus === "queued" && !!url) && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-surface-subtle"
          aria-label={`PDF thumbnail unavailable for ${title}`}
        >
          {importStatus === "failed" || importStatus === "error" ? (
            <div className="flex flex-col items-center gap-1">
              <div className=" bg-rose-600/90 p-1 text-white">
                <X className="h-4 w-4" />
              </div>
              <div className="text-[10px] font-semibold text-rose-600">Failed</div>
            </div>
          ) : importStatus === "processing" || importStatus === "uploading" ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 className="h-4 w-4 animate-spin text-action-primary-bg" />
              {typeof progressPercent === "number" ? (
                <div className="text-[10px] font-semibold text-text-default">{progressPercent}%</div>
              ) : (
                <div className="text-[10px] text-text-muted">Processing</div>
              )}
            </div>
          ) : (
            <FileText className="h-4 w-4 text-text-muted" />
          )}
        </div>
      )}

      {/* Small success badge when available */}
      {hasRendered && (importStatus === "completed" || importStatus === "done") && (
        <div className="absolute right-0 top-0 m-1  bg-green-500/90 p-0.5 text-white">
          <Check className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
