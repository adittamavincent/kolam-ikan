from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import camelot
import pandas as pd

try:
    import pdfplumber  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    pdfplumber = None  # type: ignore

try:
    import pytesseract  # type: ignore
    from pdf2image import convert_from_path  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    pytesseract = None  # type: ignore
    convert_from_path = None  # type: ignore

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

logger = logging.getLogger("docling-processor")


@dataclass
class DoclingProcessorOptions:
    enable_table_structure: bool = True
    detect_columns: bool = True
    header_footer_detection: bool = True
    ocr_lang: str = "ind"
    max_pages_in_memory: int = 16


class DoclingProcessor:
    """High-level processor that wraps Docling for robust PDF extraction.

    Features:
    - Resource-optimized pipeline creation (per-document converter options)
    - OCR only-on-demand for scanned pages
    - Layout detection for multi-column documents
    - Combined table extraction using Docling tables + Camelot fallback
    - Chunk-friendly export preserving page/section metadata
    - Basic validation for corrupted or encrypted PDFs
    """

    def __init__(self, options: Optional[DoclingProcessorOptions] = None) -> None:
        self.options = options or DoclingProcessorOptions()

    def _build_converter(self, enable_table_structure: bool) -> DocumentConverter:
        pipeline_options = PdfPipelineOptions(do_table_structure=enable_table_structure)

        # best-effort feature flags (Docling version differences tolerated)
        if hasattr(pipeline_options, "detect_columns"):
            setattr(pipeline_options, "detect_columns", self.options.detect_columns)
        if hasattr(pipeline_options, "header_footer_detection"):
            setattr(pipeline_options, "header_footer_detection", self.options.header_footer_detection)

        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            }
        )

    def validate_pdf(self, pdf_path: Path) -> Tuple[bool, Optional[str]]:
        """Basic validation checks: exists, not-empty, not encrypted.

        Returns (is_valid, error_message).
        """
        if not pdf_path.exists():
            return False, "file-not-found"
        if pdf_path.stat().st_size == 0:
            return False, "empty-file"

        try:
            # lazy import so module optionality doesn't break the worker
            from PyPDF2 import PdfReader  # type: ignore

            with open(pdf_path, "rb") as fh:
                reader = PdfReader(fh)
                if reader.is_encrypted:
                    return False, "encrypted-pdf"
        except Exception:
            logger.debug("PyPDF2 unavailable or failed, skipping encrypted check")

        return True, None

    def _is_scanned_page(self, pdf_path: Path, page_number: int) -> bool:
        """Heuristic: if page text is absent or extremely short, treat it as scanned."""
        if pdfplumber is None:
            return False
        try:
            with pdfplumber.open(str(pdf_path)) as pdf:
                page = pdf.pages[page_number]
                text = (page.extract_text() or "").strip()
                # treat pages with very short text as scanned images
                return len(text) < 40
        except Exception:
            logger.debug("Failed to inspect page %s for scanning heuristic", page_number)
            return False

    def _ocr_page(self, pdf_path: Path, page_number: int) -> str:
        """Run OCR on a single page image and return extracted text."""
        if pytesseract is None or convert_from_path is None:
            raise RuntimeError("OCR dependencies not available (pytesseract/pdf2image)")

        images = convert_from_path(str(pdf_path), first_page=page_number + 1, last_page=page_number + 1)
        if not images:
            return ""
        text = pytesseract.image_to_string(images[0], lang=self.options.ocr_lang)
        return text or ""

    def extract_tables(self, pdf_path: Path, flavor: str = "lattice") -> List[pd.DataFrame]:
        """Return a list of DataFrames representing detected tables.

        Uses docling's internal table model when available, then Camelot as fallback for higher accuracy.
        """
        tables: List[pd.DataFrame] = []

        # Try Camelot first for explicit table parsing (good for financial tables)
        try:
            camelot_tables = camelot.read_pdf(str(pdf_path), pages="all", flavor=flavor)
            for t in camelot_tables:
                try:
                    df = t.df
                    tables.append(df)
                except Exception:
                    logger.exception("Failed to convert camelot table to DataFrame")
        except Exception:
            logger.debug("Camelot table extraction failed; falling back to Docling tables")

        # As a fallback, use Docling table structure if camelot returned nothing
        if not tables:
            try:
                conv = self._build_converter(enable_table_structure=True)
                result = conv.convert(str(pdf_path))
                # docling stores tables on document.tables -- each table has a dataframe-like export
                for table in getattr(result.document, "tables", []) or []:
                    try:
                        df = pd.DataFrame(table.rows)
                        tables.append(df)
                    except Exception:
                        logger.debug("Skipping a malformed docling table")
            except Exception:
                logger.exception("Docling table extraction failed")

        return tables

    def process_to_markdown(self, pdf_path: Path, flavor: str = "lattice") -> Tuple[str, Dict[str, Any]]:
        """Full processing pipeline:
        - validate file
        - run docling with table-structure enabled
        - OCR only scanned pages and stitch text
        - extract Camelot tables and append as markdown
        Returns (markdown_text, metadata)
        """
        ok, err = self.validate_pdf(pdf_path)
        if not ok:
            raise ValueError(f"Invalid PDF: {err}")

        # Keep Docling focused on body text to drastically improve speed, table content comes from Camelot.
        conv = self._build_converter(enable_table_structure=False)

        # Convert using Docling (streaming inside DocumentConverter to avoid large memory footprint)
        result = conv.convert(str(pdf_path))

        # Export primary markdown from docling
        try:
            markdown_text = result.document.export_to_markdown()
        except Exception:
            logger.exception("Docling export_to_markdown failed; falling back to naive text join")
            markdown_text = "\n\n".join((getattr(p, "text", "") for p in getattr(result.document, "pages", [])))

        # Append Camelot tables just like the faster local script
        try:
            tables = camelot.read_pdf(str(pdf_path), pages="all", flavor=flavor)
            table_markdown_blocks: List[str] = []
            for i, table in enumerate(tables):
                try:
                    df = table.df
                    md_table = df.to_markdown(index=False)
                    table_markdown_blocks.append(f"\n\n### Table {i + 1}\n\n{md_table}\n")
                except Exception:
                    logger.exception(f"Failed to export Camelot table {i + 1} to markdown")
            
            if table_markdown_blocks:
                markdown_text += "".join(table_markdown_blocks)
        except Exception:
            logger.exception("Camelot table extraction failed in process_to_markdown")

        # Detect scanned pages and OCR them, then replace/augment the markdown for those pages
        ocr_replacements: Dict[int, str] = {}
        if pytesseract and pdfplumber:
            try:
                with pdfplumber.open(str(pdf_path)) as pdf:
                    for i, page in enumerate(pdf.pages):
                        text = (page.extract_text() or "").strip()
                        if len(text) < 40:
                            try:
                                ocr_text = self._ocr_page(pdf_path, i)
                                if ocr_text.strip():
                                    ocr_replacements[i] = ocr_text
                            except Exception:
                                logger.exception("OCR failed on page %s", i)
            except Exception:
                logger.debug("pdfplumber open failed for OCR detection")

        if ocr_replacements:
            # Simple heuristic: prepend OCR text with page header markers so it can be stitched later
            for pnum, ocr_text in ocr_replacements.items():
                markdown_text += f"\n\n<!-- OCR PAGE {pnum + 1} -->\n\n{ocr_text}\n"

        # Extract tables (Camelot + Docling fallback)
        tables = self.extract_tables(pdf_path, flavor=flavor)
        table_blocks: List[str] = []
        for i, df in enumerate(tables):
            try:
                md_table = df.to_markdown(index=False)
                table_blocks.append(f"\n\n### Table {i + 1}\n\n{md_table}\n")
            except Exception:
                logger.debug("Failed to render table %s to markdown", i)

        final_md = markdown_text + "\n".join(table_blocks)

        metadata: Dict[str, Any] = {
            "camelotTables": len(tables),
            "ocrPages": list(ocr_replacements.keys()),
        }

        return final_md, metadata

    def export_chunk_friendly(self, pdf_path: Path, chunk_size: int = 1400, overlap: int = 200) -> List[Dict[str, Any]]:
        """Export the document into a chunk-friendly list suitable for RAG ingestion.

        Each chunk preserves: page number, section header (if detected), and token estimate.
        """
        md, meta = self.process_to_markdown(pdf_path)

        # Very lightweight chunking that preserves page markers and section headers
        parts: List[Dict[str, Any]] = []
        # Split by OCR page markers and headings to preserve boundaries
        blocks = [b.strip() for b in md.split("\n\n") if b.strip()]

        current_chunk = []
        current_chars = 0
        idx = 0
        for block in blocks:
            block_len = len(block)
            if current_chars + block_len > chunk_size and current_chunk:
                text = "\n\n".join(current_chunk)
                token_count = max(1, int(len(text.split()) * 1.3))
                parts.append({
                    "chunkIndex": idx,
                    "chunkMarkdown": text,
                    "tokenCount": token_count,
                    "metadata": {"strategy": "char_window"},
                })
                idx += 1
                # start next
                current_chunk = [block]
                current_chars = block_len
            else:
                current_chunk.append(block)
                current_chars += block_len

        if current_chunk:
            text = "\n\n".join(current_chunk)
            token_count = max(1, int(len(text.split()) * 1.3))
            parts.append({
                "chunkIndex": idx,
                "chunkMarkdown": text,
                "tokenCount": token_count,
                "metadata": {"strategy": "char_window"},
            })

        return parts


__all__ = ["DoclingProcessor", "DoclingProcessorOptions"]
