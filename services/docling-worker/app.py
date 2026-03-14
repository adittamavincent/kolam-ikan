from __future__ import annotations

# pyright: reportMissingImports=false

import asyncio
import logging
import math
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pdf2image import convert_from_path  # type: ignore
from PIL import Image
from pydantic import BaseModel, Field
from supabase import create_client, Client

from converters import convert_to_markdown
from docling.chunking import HierarchicalChunker

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
    await loop.run_in_executor(None, _prewarm_models)

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


def _prewarm_models() -> None:
    """Best-effort prewarm to avoid first-job cold start."""
    try:
        from converters.pdf_converter import _get_converter

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

    await post_callback(request, payload)


def generate_and_upload_thumbnail(
    source_path: Path,
    document_id: str,
    content_type: str,
    file_name: str,
) -> str | None:
    """Generate thumbnail for supported types and upload to Supabase storage."""
    temp_thumb_path: Path | None = None
    try:
        lowered_name = file_name.lower()
        ctype = content_type.lower()

        if ctype == "application/pdf" or lowered_name.endswith(".pdf"):
            images = convert_from_path(str(source_path), first_page=1, last_page=1, size=(300, 400))
            if not images:
                logger.warning("No images generated from PDF for document %s", document_id)
                return None
            thumb_image = images[0]
        elif ctype.startswith("image/") or lowered_name.endswith((".png", ".jpg", ".jpeg", ".tiff", ".webp")):
            with Image.open(source_path) as image:
                thumb_image = image.copy()
            thumb_image.thumbnail((300, 400))
        else:
            # DOCX/PPTX/audio/URL types intentionally skip thumbnail generation.
            return None

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_thumb:
            thumb_image.save(temp_thumb.name, "PNG")
            temp_thumb_path = Path(temp_thumb.name)

        # Upload to Supabase storage
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not supabase_url or not supabase_key:
            logger.error("Supabase credentials not configured for thumbnail upload")
            return None

        supabase: Client = create_client(supabase_url, supabase_key)

        thumbnail_path = f"{document_id}.png"

        with open(temp_thumb_path, "rb") as f:
            file_data = f.read()

        response = supabase.storage.from_("thumbnails").upload(
            path=thumbnail_path,
            file=file_data,
            file_options={"content-type": "image/png"}
        )

        # supabase-py returns upload metadata, not an HTTP response object.
        # Any upload failure throws; if we get here, treat it as success.
        if not response:
            logger.error("Failed to upload thumbnail for document %s: empty upload response", document_id)
            return None

        logger.info("Generated and uploaded thumbnail for %s", document_id)
        return thumbnail_path

    except Exception:
        logger.exception("Failed to generate/upload thumbnail for document %s", document_id)
        return None
    finally:
        if temp_thumb_path and temp_thumb_path.exists():
            temp_thumb_path.unlink(missing_ok=True)


async def process_import(request: ImportRequest) -> None:
    temp_file_path: Path | None = None
    try:
        storage_url = rewrite_localhost_url(
            request.fileUrl,
            os.getenv("DOC_IMPORT_STORAGE_BASE_URL", "").strip() or None,
        )

        # Stream download in chunks to avoid large memory spikes and add simple retries.
        download_timeout = float(os.getenv("DOC_IMPORT_DOWNLOAD_TIMEOUT", "300"))
        max_attempts = int(os.getenv("DOC_IMPORT_MAX_DOWNLOAD_ATTEMPTS", "3"))
        last_exc: Exception | None = None
        suffix = Path(request.fileName).suffix or ".bin"
        for attempt in range(1, max_attempts + 1):
            try:
                if request.contentType == "text/url" or request.fileName.startswith(("http://", "https://")):
                    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as temp_file:
                        temp_file_path = Path(temp_file.name)
                        temp_file.write(request.fileName)
                else:
                    async with httpx.AsyncClient(timeout=download_timeout) as client:
                        async with client.stream("GET", storage_url) as response:
                            response.raise_for_status()
                            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                                temp_file_path = Path(temp_file.name)
                                async for chunk in response.aiter_bytes(chunk_size=8192):
                                    if chunk:
                                        temp_file.write(chunk)
                last_exc = None
                break
            except Exception as exc:  # noqa: BLE001
                logger.exception("Download attempt %s failed for %s", attempt, storage_url)
                last_exc = exc
        if last_exc is not None:
            raise last_exc

        await send_progress(
            request,
            status="processing",
            progress_percent=25,
            progress_message="Generating thumbnail",
            eta_seconds=5,
        )

        thumbnail_path = generate_and_upload_thumbnail(
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
        )

        loop = asyncio.get_running_loop()
        markdown, extraction_metadata = await loop.run_in_executor(
            None,
            convert_to_markdown,
            temp_file_path,
            request.contentType,
            request.fileName,
            request.parserConfig,
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

    try:
        await send_progress(
            request,
            status="queued",
            progress_percent=0,
            progress_message="Queued for import",
            eta_seconds=None,
        )
    except Exception:
        logger.exception("Failed to send queued callback for job %s", request.jobId)

    return {
        "accepted": True,
        "jobId": request.jobId,
        "message": "Import job queued",
        "worker": os.getenv("HOSTNAME", "local"),
    }
