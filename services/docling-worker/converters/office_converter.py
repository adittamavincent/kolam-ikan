import logging
import threading
from pathlib import Path
from typing import Any, Tuple

import pandas as pd # type: ignore

from docling.datamodel.base_models import InputFormat # type: ignore
from docling.document_converter import DocumentConverter # type: ignore

logger = logging.getLogger("office_converter")

_OFFICE_CONVERTER: DocumentConverter | None = None
_CONVERTER_LOCK = threading.Lock()

def _get_office_converter() -> DocumentConverter:
    global _OFFICE_CONVERTER
    with _CONVERTER_LOCK:
        if _OFFICE_CONVERTER is None:
            _OFFICE_CONVERTER = DocumentConverter(
                allowed_formats=[
                    InputFormat.DOCX, 
                    InputFormat.PPTX, 
                    InputFormat.XLSX,
                    # Fallbacks if EPUB/etc are supported depending on docling version, 
                    # else we handle it without explicit allowed_formats? 
                    # Let's just create a generic one.
                ]
            )
        return _OFFICE_CONVERTER

def convert_office(file_path: Path, content_type: str, file_name: str, options: Any) -> Tuple[str, dict[str, Any]]:
    try:
        # Pre-process specifically for XLSX to also get per-sheet tables
        is_xlsx = file_name.lower().endswith(".xlsx") or content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        
        md_text = ""
        metadata: dict[str, Any] = {"inputFormat": "office"}
        
        try:
            conv = _get_office_converter()
            result = conv.convert(str(file_path))
            md_text = result.document.export_to_markdown()
            metadata["docling_document"] = result.document
        except Exception:
            logger.exception("Docling convert failed for office document")
        
        if is_xlsx:
            # Fallback/Appended extraction via pandas for reliable table output
            try:
                xls = pd.ExcelFile(str(file_path))
                metadata["sheetCount"] = len(xls.sheet_names)
                for sheet_name in xls.sheet_names:
                    df = pd.read_excel(xls, sheet_name=sheet_name)
                    md_text += f"\n\n### Sheet: {sheet_name}\n\n{df.to_markdown(index=False)}\n"
            except Exception:
                logger.exception("Pandas extraction failed for XLSX")

        return md_text, metadata
    except Exception as e:
        logger.exception("Error in office_converter")
        return "", {"error": str(e)}
