from __future__ import annotations

# pyright: reportMissingImports=false

import logging
import math
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import camelot
import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pdf2image import convert_from_path  # type: ignore
from pydantic import BaseModel, Field
from supabase import create_client, Client
from tqdm import tqdm

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("docling-worker")

app = FastAPI(title="Kolam Ikan Docling Worker", version="0.1.0")


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


def build_docling_converter(enable_table_structure: bool) -> DocumentConverter:
    pipeline_options = PdfPipelineOptions(do_table_structure=enable_table_structure)
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


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
        payload["extractionMetadata"] = extraction_metadata
    if warning_messages is not None:
        payload["warningMessages"] = warning_messages
    if error_message is not None:
        payload["errorMessage"] = error_message
    if chunks is not None:
        payload["chunks"] = chunks
    if thumbnail_path is not None:
        payload["thumbnailPath"] = thumbnail_path

    await post_callback(request, payload)


def convert_pdf_to_markdown(pdf_path: Path, flavor: str) -> tuple[str, dict[str, Any]]:
    text_converter = build_docling_converter(enable_table_structure=False)
    result = text_converter.convert(str(pdf_path))
    markdown_text = result.document.export_to_markdown()

    tables = camelot.read_pdf(str(pdf_path), pages="all", flavor=flavor)

    table_markdown_blocks: list[str] = []
    for i, table in enumerate(tqdm(tables, desc="Extracting tables", leave=False)):
        df = table.df
        md_table = df.to_markdown(index=False)
        table_markdown_blocks.append(f"\n\n### Table {i + 1}\n\n{md_table}\n")

    final_md = markdown_text + "\n".join(table_markdown_blocks)
    metadata = {
        "doclingTables": len(result.document.tables),
        "camelotTables": len(tables),
        "camelotFlavor": flavor,
    }
    return final_md, metadata


def generate_and_upload_thumbnail(pdf_path: Path, document_id: str) -> str | None:
    """Generate a thumbnail from the first page of the PDF and upload to Supabase storage."""
    temp_thumb_path: Path | None = None
    try:
        # Generate thumbnail from first page
        images = convert_from_path(str(pdf_path), first_page=1, last_page=1, size=(300, 400))
        if not images:
            logger.warning("No images generated from PDF for document %s", document_id)
            return None

        # Save thumbnail to temporary file
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_thumb:
            images[0].save(temp_thumb.name, "PNG")
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

        logger.info("Generated and uploaded thumbnail for document %s", document_id)
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
        await send_progress(
            request,
            status="processing",
            progress_percent=10,
            progress_message="Downloading PDF from storage",
            eta_seconds=max(10, math.ceil(request.fileSizeBytes / (512 * 1024)) * 8),
        )

        storage_url = rewrite_localhost_url(
            request.fileUrl,
            os.getenv("DOC_IMPORT_STORAGE_BASE_URL", "").strip() or None,
        )

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(storage_url)
            response.raise_for_status()
            pdf_bytes = response.content

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_file:
            temp_file.write(pdf_bytes)
            temp_file_path = Path(temp_file.name)

        await send_progress(
            request,
            status="processing",
            progress_percent=25,
            progress_message="Generating thumbnail",
            eta_seconds=5,
        )

        thumbnail_path = generate_and_upload_thumbnail(temp_file_path, request.documentId)

        await send_progress(
            request,
            status="processing",
            progress_percent=35,
            progress_message="Running Docling and table extraction",
            eta_seconds=max(8, math.ceil(len(pdf_bytes) / (512 * 1024)) * 6),
        )

        markdown, extraction_metadata = convert_pdf_to_markdown(
            temp_file_path,
            flavor=request.parserConfig.flavor,
        )

        await send_progress(
            request,
            status="processing",
            progress_percent=75,
            progress_message="Chunking markdown for retrieval",
            eta_seconds=6,
        )

        chunks = chunk_markdown(markdown)

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

    background_tasks.add_task(process_import, request)

    return {
        "accepted": True,
        "jobId": request.jobId,
        "message": "Import job accepted",
        "worker": os.getenv("HOSTNAME", "local"),
    }
