from __future__ import annotations

# pyright: reportMissingImports=false

import asyncio
import logging
import math
import os
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx # type: ignore
from fastapi import BackgroundTasks, FastAPI, HTTPException # type: ignore
from pdf2image import convert_from_path  # type: ignore
from PIL import Image # type: ignore
from pydantic import BaseModel, Field # type: ignore

from converters import convert_to_markdown # type: ignore
from docling.chunking import HierarchicalChunker # type: ignore
from progress_tracker import PageProgress # type: ignore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docling-worker")

app = FastAPI(title="Kolam Ikan Docling Worker", version="0.1.0")

# In-process queue for sequential processing. Jobs are accepted and marked
# 'queued' immediately; the consumer pulls jobs off the queue one-at-a-time
# and runs `process_import` so we never run multiple imports concurrently.
import_queue: "asyncio.Queue[ImportRequest]" = asyncio.Queue()


async def import_worker() -> None:
    logger.info("Import worker started, processing jobs sequentially")
    while True:
        request = await import_queue.get()
        try:
            # Mark job as processing before actually starting heavy work
            try:
                await send_progress(
                    request,
                    status="processing",
                    progress_percent=5,
                    progress_message="Starting import",
                    eta_seconds=None,
                )
            except Exception:
                logger.exception("Failed to send processing start callback for %s", request.jobId)

            await process_import(request)
        except Exception:
            logger.exception("Unhandled error while processing import %s", request.jobId)
        finally:
            import_queue.task_done()


@app.on_event("startup")
async def start_import_worker() -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: _prewarm_models()) # type: ignore

    # Spawn the background consumer task after models are warmed.
    asyncio.create_task(import_worker())


LOCALHOST_HOSTS = {"localhost", "127.0.0.1", "::1"}


def rewrite_localhost_url(url: str, override_base_url: str | None) -> str:
    if not override_base_url:
        return url

    parsed_url = urlparse(url)
    parsed_override = urlparse(override_base_url)
    if parsed_url.hostname in LOCALHOST_HOSTS and parsed_override.scheme and parsed_override.netloc:
        return parsed_url._replace(
            scheme=parsed_override.scheme,
            netloc=parsed_override.netloc,
        ).geturl()

    return url


def _supabase_headers(service_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }


def upload_thumbnail_to_storage(
    supabase_url: str,
    service_key: str,
    thumbnail_path: str,
    file_data: bytes,
) -> bool:
    url = f"{supabase_url}/storage/v1/object/thumbnails/{thumbnail_path}"
    headers = {
        **_supabase_headers(service_key),
        "Content-Type": "image/png",
        "x-upsert": "true",
    }
    try:
        response = httpx.post(url, headers=headers, content=file_data, timeout=60.0)
        if response.status_code >= 300:
            logger.error(
                "Thumbnail upload failed (%s): %s",
                response.status_code,
                response.text,
            )
            return False
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Thumbnail upload failed with exception")
        return False


def update_document_thumbnail_status(
    supabase_url: str,
    service_key: str,
    document_id: str,
    payload: dict[str, Any],
) -> bool:
    url = f"{supabase_url}/rest/v1/documents?id=eq.{document_id}"
    headers = {
        **_supabase_headers(service_key),
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    try:
        response = httpx.patch(url, headers=headers, json=payload, timeout=30.0)
        if response.status_code >= 300:
            logger.error(
                "Document update failed (%s): %s",
                response.status_code,
                response.text,
            )
            return False
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Document update failed with exception")
        return False


class ParserConfig(BaseModel):
    flavor: str = Field(default="lattice")
    enableTableStructure: bool = Field(default=True)
    debugDoclingTables: bool = Field(default=False)
    ocrLang: str = Field(default="ind")
    whisperModel: str = Field(default="base")
    webStripBoilerplate: bool = Field(default=True)


class ImportRequest(BaseModel):
    jobId: str
    documentId: str
    streamId: str
    title: str
    fileName: str
    contentType: str
    fileSizeBytes: int
    parserConfig: ParserConfig
    fileUrl: str
    callbackUrl: str
    callbackToken: str


class ThumbnailRequest(BaseModel):
    documentId: str
    fileName: str
    contentType: str
    fileUrl: str


async def download_source_file(
    file_url: str,
    file_name: str,
    content_type: str,
) -> Path:
    storage_url = rewrite_localhost_url(
        file_url,
        os.getenv("DOC_IMPORT_STORAGE_BASE_URL", "").strip() or None,
    )

    download_timeout = float(os.getenv("DOC_IMPORT_DOWNLOAD_TIMEOUT", "300"))
    max_attempts = int(os.getenv("DOC_IMPORT_MAX_DOWNLOAD_ATTEMPTS", "3"))
    last_exc: Exception | None = None
    suffix = Path(file_name).suffix or ".bin"

    for attempt in range(1, max_attempts + 1):
        try:
            if content_type == "text/url" or file_name.startswith(("http://", "https://")):
                with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as temp_text_file:
                    temp_file_path = Path(temp_text_file.name)
                    temp_text_file.write(file_name)
            else:
                async with httpx.AsyncClient(timeout=download_timeout) as client:
                    async with client.stream("GET", storage_url) as response:
                        response.raise_for_status()
                        with tempfile.NamedTemporaryFile(mode="wb", suffix=suffix, delete=False) as temp_bin_file: # type: ignore
                            temp_file_path = Path(temp_bin_file.name)
                            async for chunk in response.aiter_bytes(chunk_size=8192):
                                if chunk:
                                    temp_bin_file.write(chunk) # type: ignore

            last_exc = None
            return temp_file_path
        except Exception as exc:  # noqa: BLE001
            logger.exception("Download attempt %s failed for %s", attempt, storage_url)
            last_exc = exc

    assert last_exc is not None
    raise last_exc


def _prewarm_models() -> None:
    """Best-effort prewarm to avoid first-job cold start."""
    try:
        from converters.pdf_converter import _get_converter # type: ignore

        _get_converter(enable_table_structure=False)
        logger.info("Prewarmed Docling PDF converter")
    except Exception:
        logger.exception("Failed to prewarm converter models")


def chunk_markdown(markdown: str, chunk_size: int = 1400, overlap: int = 200) -> list[dict[str, Any]]:
    markdown_content = markdown.strip()
    if not markdown_content:
        return []

    chunks: list[dict[str, Any]] = []
    text_len = len(markdown_content)
    start = 0
    index = 0

    while start < text_len:
        end = min(text_len, start + chunk_size)
        # Ensure indices are integers for slicing
        s_start: int = int(start)
        s_end: int = int(end)
        chunk_text = markdown_content[s_start:s_end]  # type: ignore
        token_count = max(1, math.ceil(len(chunk_text.split()) * 1.3))
        chunks.append(
            {
                "chunkIndex": index,
                "chunkMarkdown": chunk_text,
                "tokenCount": token_count,
                "metadata": {
                    "charStart": start,
                    "charEnd": end,
                    "strategy": "char_window",
                },
            }
        )
        if end >= text_len:
            break
        start = max(0, end - overlap)
        index += 1

    return chunks


def chunk_document(docling_document: Any, fallback_markdown: str) -> list[dict[str, Any]]:
    if docling_document is None:
        return chunk_markdown(fallback_markdown)

    try:
        chunker = HierarchicalChunker()
        chunks: list[dict[str, Any]] = []
        for i, chunk in enumerate(chunker.chunk(docling_document)):
            chunks.append(
                {
                    "chunkIndex": i,
                    "chunkMarkdown": chunk.text,
                    "tokenCount": max(1, int(len(chunk.text.split()) * 1.3)),
                    "metadata": {
                        "headings": getattr(chunk.meta, "headings", []),
                        "pageNumbers": getattr(chunk.meta, "page_numbers", []),
                        "strategy": "hierarchical",
                    },
                }
            )
        return chunks
    except Exception:
        logger.exception("Hierarchical chunking failed, falling back to char_window")
        return chunk_markdown(fallback_markdown)


async def post_callback(request: ImportRequest, payload: dict[str, Any]) -> None:
    callback_url = rewrite_localhost_url(
        request.callbackUrl,
        os.getenv("DOC_IMPORT_CALLBACK_BASE_URL", "").strip() or None,
    )

    headers = {
        "Authorization": f"Bearer {request.callbackToken}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(callback_url, headers=headers, json=payload)
        response.raise_for_status()


async def send_progress(
    request: ImportRequest,
    *,
    status: str,
    progress_percent: int,
    progress_message: str,
    eta_seconds: int | None,
    extracted_markdown: str | None = None,
    extraction_metadata: dict[str, Any] | None = None,
    warning_messages: list[str] | None = None,
    error_message: str | None = None,
    chunks: list[dict[str, Any]] | None = None,
    thumbnail_path: str | None = None,
    thumbnail_status: str | None = None,
    thumbnail_error: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "documentId": request.documentId,
        "jobId": request.jobId,
        "status": status,
        "progressPercent": progress_percent,
        "progressMessage": progress_message,
        "etaSeconds": eta_seconds,
    }
    if extracted_markdown is not None:
        payload["extractedMarkdown"] = extracted_markdown
    if extraction_metadata is not None:
        safe_meta = dict(extraction_metadata)
        safe_meta.pop("docling_document", None)
        payload["extractionMetadata"] = safe_meta
    if warning_messages is not None:
        payload["warningMessages"] = warning_messages
    if error_message is not None:
        payload["errorMessage"] = error_message
    if chunks is not None:
        payload["chunks"] = chunks
    if thumbnail_path is not None:
        payload["thumbnailPath"] = thumbnail_path
    if thumbnail_status is not None:
        payload["thumbnailStatus"] = thumbnail_status
    if thumbnail_error is not None:
        payload["thumbnailError"] = thumbnail_error

    await post_callback(request, payload)


def generate_and_upload_thumbnail(
    source_path: Path,
    document_id: str,
    content_type: str,
    file_name: str,
) -> tuple[str | None, str, str | None]:
    """Generate thumbnail for supported types and upload to Supabase storage."""
    temp_thumb_path: Path | None = None
    try:
        lowered_name = file_name.lower()
        ctype = content_type.lower()

        if ctype == "application/pdf" or lowered_name.endswith(".pdf"):
            images = convert_from_path(str(source_path), first_page=1, last_page=1, size=(300, 400))
            if not images:
                logger.warning("No images generated from PDF for document %s", document_id)
                return None, "failed", "No images generated from PDF"
            thumb_image = images[0]
        elif ctype.startswith("image/") or lowered_name.endswith((".png", ".jpg", ".jpeg", ".tiff", ".webp")):
            with Image.open(source_path) as image:
                thumb_image = image.copy()
            thumb_image.thumbnail((300, 400))
        else:
            # DOCX/PPTX/audio/URL types intentionally skip thumbnail generation.
            logger.info(
                "Skipping thumbnail generation for %s (content_type=%s, filename=%s)",
                document_id,
                content_type,
                file_name,
            )
            return None, "unsupported", None

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_thumb:
            thumb_image.save(temp_thumb.name, "PNG")
            temp_thumb_path = Path(temp_thumb.name)

        # Upload to Supabase storage
        thumbnail_path = f"{document_id}.png"

        with open(temp_thumb_path, "rb") as f:
            file_data = f.read()

        supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not supabase_url or not supabase_key:
            logger.error("Supabase credentials not configured for thumbnail upload")
            return None, "failed", "Supabase credentials not configured"

        upload_ok = upload_thumbnail_to_storage(
            str(supabase_url),
            str(supabase_key),
            thumbnail_path,
            file_data,
        )
        if not upload_ok:
            return None, "failed", "Thumbnail upload failed"

        logger.info("Generated and uploaded thumbnail for %s", document_id)
        return thumbnail_path, "ready", None

    except Exception as exc:
        logger.exception("Failed to generate/upload thumbnail for document %s", document_id)
        return None, "failed", str(exc)
    finally:
        if temp_thumb_path and temp_thumb_path.exists():
            temp_thumb_path.unlink(missing_ok=True)
    return None, "failed", "Unknown error" # Fallback return if reaching here


async def process_import(request: ImportRequest) -> None:
    temp_file_path: Path | None = None
    try:
        temp_file_path = await download_source_file(
            request.fileUrl,
            request.fileName,
            request.contentType,
        )

        await send_progress(
            request,
            status="processing",
            progress_percent=25,
            progress_message="Generating thumbnail",
            eta_seconds=5,
        )

        thumbnail_path, thumbnail_status, thumbnail_error = generate_and_upload_thumbnail(
            temp_file_path,
            request.documentId,
            request.contentType,
            request.fileName,
        )

        file_size = temp_file_path.stat().st_size if temp_file_path and temp_file_path.exists() else request.fileSizeBytes

        await send_progress(
            request,
            status="processing",
            progress_percent=35,
            progress_message="Converting to markdown",
            eta_seconds=max(8, math.ceil(file_size / (512 * 1024)) * 6),
            thumbnail_path=thumbnail_path,
            thumbnail_status=thumbnail_status,
            thumbnail_error=thumbnail_error,
        )

        loop = asyncio.get_running_loop()
        last_reported_percent = 35
        first_docling_tick_sent = False

        def on_docling_progress(tracker: PageProgress) -> None:
            nonlocal last_reported_percent, first_docling_tick_sent

            docling_percent = tracker.percent
            overall_percent = 35 + int(docling_percent * 0.40)
            if overall_percent > 74:
                overall_percent = 74

            # Force an immediate update on the first event or transition to table extraction
            is_new_stage = tracker.stage == "table extraction" and overall_percent >= 74
            force_first = not first_docling_tick_sent

            if not force_first and not is_new_stage:
               if overall_percent < last_reported_percent + 3 and overall_percent < 74:
                   return
               if overall_percent <= last_reported_percent:
                   return

            first_docling_tick_sent = True
            last_reported_percent = overall_percent

            asyncio.run_coroutine_threadsafe(
                send_progress(
                    request,
                    status="processing",
                    progress_percent=overall_percent,
                    progress_message=tracker.message,
                    eta_seconds=tracker.eta_seconds,
                ),
                loop,
            )

        markdown, extraction_metadata = await loop.run_in_executor(
            None,
            lambda: convert_to_markdown( # type: ignore
                temp_file_path,
                request.contentType,
                request.fileName,
                request.parserConfig,
                on_progress=on_docling_progress,
            ),
        )
        if extraction_metadata.get("error"):
            raise RuntimeError(extraction_metadata["error"])

        await send_progress(
            request,
            status="processing",
            progress_percent=75,
            progress_message="Chunking markdown for retrieval",
            eta_seconds=6,
        )

        chunks = chunk_document(extraction_metadata.get("docling_document"), markdown)

        await send_progress(
            request,
            status="completed",
            progress_percent=100,
            progress_message="Import completed",
            eta_seconds=0,
            extracted_markdown=markdown,
            extraction_metadata=extraction_metadata,
            warning_messages=[],
            chunks=chunks,
            thumbnail_path=thumbnail_path,
            thumbnail_status=thumbnail_status,
            thumbnail_error=thumbnail_error,
        )

        logger.info("Completed import job %s for document %s", request.jobId, request.documentId)
    except Exception as error:  # noqa: BLE001
        logger.exception("Failed import job %s", request.jobId)
        try:
            await send_progress(
                request,
                status="failed",
                progress_percent=0,
                progress_message="Import failed",
                eta_seconds=None,
                error_message=str(error),
            )
        except Exception:  # noqa: BLE001
            logger.exception("Failed to send failure callback for job %s", request.jobId)
    finally:
        if temp_file_path and temp_file_path.exists():
            temp_file_path.unlink(missing_ok=True)

@app.post("/thumbnails")
async def create_thumbnail(request: ThumbnailRequest) -> dict[str, Any]:
    temp_file_path: Path | None = None
    try:
        temp_file_path = await download_source_file(
            request.fileUrl,
            request.fileName,
            request.contentType,
        )

        thumbnail_path, thumbnail_status, thumbnail_error = generate_and_upload_thumbnail(
            temp_file_path,
            request.documentId,
            request.contentType,
            request.fileName,
        )

        supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if supabase_url and supabase_key:
            update_payload = {
                "thumbnail_status": thumbnail_status,
                "thumbnail_error": thumbnail_error,
                "thumbnail_updated_at": datetime.utcnow().isoformat(),
            }
            if thumbnail_status == "ready":
                update_payload["thumbnail_path"] = thumbnail_path
            update_document_thumbnail_status(
                supabase_url,
                supabase_key,
                request.documentId,
                update_payload,
            )
        else:
            logger.error("Supabase credentials not configured for thumbnail status update")

        return {
            "status": thumbnail_status,
            "thumbnailPath": thumbnail_path,
            "error": thumbnail_error,
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed thumbnail job for document %s", request.documentId)
        return {"status": "failed", "error": str(exc)}
    finally:
        if temp_file_path and temp_file_path.exists():
            temp_file_path.unlink(missing_ok=True)
    return {"status": "failed", "error": "Internal processor error"}


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/imports")
async def create_import(request: ImportRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if request.parserConfig.flavor not in {"lattice", "stream"}:
        raise HTTPException(status_code=400, detail="Unsupported Camelot flavor")

    # Enqueue the request for sequential processing and notify the caller
    # that the job is queued. The `import_worker` will pick jobs off the
    # queue and mark them 'processing' when it starts them.
    await import_queue.put(request)

    # Fire the initial queued callback in the background so we don't
    # block the HTTP response and cause a deadlock with the Next.js dev server.
    background_tasks.add_task(
        send_progress,
        request,
        status="queued",
        progress_percent=0,
        progress_message="Queued for import",
        eta_seconds=None,
    )

    return {
        "accepted": True,
        "jobId": request.jobId,
        "message": "Import job queued",
        "worker": os.getenv("HOSTNAME", "local"),
    }
