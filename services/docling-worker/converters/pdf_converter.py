import logging
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

try:
    import camelot  # type: ignore[import]
except Exception:
    camelot = None

try:
    import pdfplumber  # type: ignore[import]
except Exception:
    pdfplumber = None

try:
    import pytesseract  # type: ignore[import]
    from pdf2image import convert_from_path  # type: ignore[import]
except Exception:
    pytesseract = None
    convert_from_path = None

from docling.datamodel.base_models import InputFormat # type: ignore
from docling.datamodel.pipeline_options import PdfPipelineOptions # type: ignore
from docling.document_converter import DocumentConverter, PdfFormatOption # type: ignore
from progress_tracker import DoclingProgressInterceptor, PageProgress # type: ignore

logger = logging.getLogger("pdf_converter")

_CONVERTER_CACHE: Dict[bool, DocumentConverter] = {}
_CONVERTER_LOCK = threading.Lock()

def _get_converter(enable_table_structure: bool) -> DocumentConverter:
    with _CONVERTER_LOCK:
        if enable_table_structure not in _CONVERTER_CACHE:
            pipeline_options = PdfPipelineOptions(do_table_structure=enable_table_structure)
            # best-effort feature flags
            if hasattr(pipeline_options, "detect_columns"):
                setattr(pipeline_options, "detect_columns", True)
            if hasattr(pipeline_options, "header_footer_detection"):
                setattr(pipeline_options, "header_footer_detection", True)

            _CONVERTER_CACHE[enable_table_structure] = DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
                }
            )
        return _CONVERTER_CACHE[enable_table_structure]

def validate_pdf(pdf_path: Path) -> Tuple[bool, str]:
    if not pdf_path.exists():
        return False, "file-not-found"
    if pdf_path.stat().st_size == 0:
        return False, "empty-file"

    try:
        from PyPDF2 import PdfReader  # type: ignore[import]
        with open(pdf_path, "rb") as fh:
            reader = PdfReader(fh)
            if reader.is_encrypted:
                return False, "encrypted-pdf"
    except Exception:
        pass

    return True, ""

def _ocr_page(pdf_path: Path, page_number: int, ocr_lang: str) -> str:
    if pytesseract is None or convert_from_path is None:
        return ""
    images = convert_from_path(str(pdf_path), first_page=page_number + 1, last_page=page_number + 1) # type: ignore
    if not images:
        return ""
    return pytesseract.image_to_string(images[0], lang=ocr_lang) or "" # type: ignore


def _convert_pdf_page_by_page(
    conv: DocumentConverter,
    file_path: Path,
    tracker: PageProgress,
    on_progress: Callable[[PageProgress], None] | None,
) -> tuple[str, Any | None]:
    try:
        from PyPDF2 import PdfReader, PdfWriter  # type: ignore[import]
    except Exception:
        logger.debug("PyPDF2 unavailable for per-page conversion; falling back to single-pass")
        with DoclingProgressInterceptor(tracker):
            result = conv.convert(str(file_path))
        return result.document.export_to_markdown(), result.document

    reader = PdfReader(str(file_path))
    page_markdown_parts: list[str] = []

    for page_index, page in enumerate(reader.pages, start=1):
        temp_page_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_page:
                temp_page_path = Path(temp_page.name)
                writer = PdfWriter()
                writer.add_page(page)
                writer.write(temp_page)

            page_result = conv.convert(str(temp_page_path))
            try:
                page_markdown_parts.append(page_result.document.export_to_markdown())
            except Exception:
                logger.exception("Docling export_to_markdown failed for page %s", page_index)
                page_markdown_parts.append("")
        finally:
            if temp_page_path and temp_page_path.exists():
                temp_page_path.unlink(missing_ok=True)

        tracker.tick(completed=page_index, total=tracker.total_pages)
        if on_progress:
            on_progress(tracker) # type: ignore

    return "\n\n".join(part for part in page_markdown_parts if part.strip()), None

def convert_pdf(
    file_path: Path,
    content_type: str,
    file_name: str,
    options: Any,
    on_progress: Callable[[PageProgress], None] | None = None,
) -> Tuple[str, dict[str, Any]]:
    try:
        ok, err = validate_pdf(file_path)
        if not ok:
            return "", {"error": f"Invalid PDF: {err}"}

        flavor = getattr(options, "flavor", "lattice")
        ocr_lang = getattr(options, "ocrLang", "ind")

        total_pages = 1
        if pdfplumber is not None:
            try:
                with pdfplumber.open(str(file_path)) as pdf:
                    total_pages = max(1, len(pdf.pages))
            except Exception:
                logger.debug("Could not pre-count pages for %s", file_name)

        tracker = PageProgress(total_pages=total_pages, stage="layout detection")
        if on_progress:
            on_progress(tracker)

        # Keep Docling focused on body text to drastically improve speed, table content comes from Camelot.
        conv = _get_converter(enable_table_structure=False)
        docling_document: Any | None = None
        if on_progress and total_pages > 1:
            markdown_text, docling_document = _convert_pdf_page_by_page(
                conv,
                file_path,
                tracker,
                on_progress,
            )
        else:
            with DoclingProgressInterceptor(tracker):
                result = conv.convert(str(file_path))

            docling_document = result.document
            try:
                markdown_text = result.document.export_to_markdown()
            except Exception:
                logger.exception("Docling export_to_markdown failed; falling back to naive text join")
                markdown_text = "\n\n".join((getattr(p, "text", "") for p in getattr(result.document, "pages", [])))

        tracker.stage = "table extraction"
        tracker.completed_pages = max(tracker.completed_pages, tracker.total_pages)
        if on_progress:
            on_progress(tracker)

        # Tables extraction via Camelot ONLY
        table_blocks: List[str] = []
        tables_count = 0
        if camelot:
            try:
                camelot_tables = camelot.read_pdf(str(file_path), pages="all", flavor=flavor)
                for i, table in enumerate(camelot_tables):
                    try:
                        df = table.df
                        md_table = df.to_markdown(index=False)
                        table_blocks.append(f"\n\n### Table {i + 1}\n\n{md_table}\n")
                        tables_count += 1 # type: ignore
                    except Exception:
                        pass
            except Exception:
                logger.exception("Camelot table extraction failed")

        # Detect scanned pages and OCR them
        ocr_replacements: Dict[int, str] = {}
        if pytesseract and pdfplumber:
            try:
                with pdfplumber.open(str(file_path)) as pdf:
                    for i, page in enumerate(pdf.pages):
                        text = (page.extract_text() or "").strip()
                        if len(text) < 40:
                            try:
                                ocr_text = _ocr_page(file_path, i, ocr_lang)
                                if ocr_text.strip():
                                    ocr_replacements[i] = ocr_text
                            except Exception:
                                pass
            except Exception:
                pass

        if ocr_replacements:
            for pnum, ocr_text in ocr_replacements.items():
                markdown_text += f"\n\n<!-- OCR PAGE {pnum + 1} -->\n\n{ocr_text}\n"

        final_md = markdown_text + "\n".join(table_blocks)

        metadata = {
            "camelotTables": tables_count,
            "ocrPages": list(ocr_replacements.keys()),
            "pageCount": max(
                tracker.total_pages,
                len(getattr(docling_document, "pages", [])) if docling_document is not None and hasattr(docling_document, "pages") else 0,
            ),
            "docling_document": docling_document,
        }

        return final_md, metadata

    except Exception as e:
        logger.exception("Error in pdf_converter")
        return "", {"error": str(e)}
