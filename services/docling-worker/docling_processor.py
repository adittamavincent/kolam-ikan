from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from converters.pdf_converter import convert_pdf # type: ignore

if TYPE_CHECKING:
    from progress_tracker import PageProgress # type: ignore


@dataclass
class DoclingProcessorOptions:
    enable_table_structure: bool = True
    detect_columns: bool = True
    header_footer_detection: bool = True
    ocr_lang: str = "ind"
    max_pages_in_memory: int = 16


class _OptionsAdapter:
    def __init__(self, flavor: str, ocr_lang: str) -> None:
        self.flavor = flavor
        self.ocrLang = ocr_lang


class DoclingProcessor:
    """Compatibility wrapper around the shared PDF converter."""

    def __init__(self, options: DoclingProcessorOptions | None = None) -> None:
        self.options = options or DoclingProcessorOptions()

    def process_to_markdown(
        self,
        pdf_path: Path,
        flavor: str = "lattice",
        on_progress: Callable[["PageProgress"], None] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        adapter = _OptionsAdapter(flavor=flavor, ocr_lang=self.options.ocr_lang)
        markdown, metadata = convert_pdf(
            pdf_path,
            "application/pdf",
            pdf_path.name,
            adapter,
            on_progress=on_progress,
        )
        if metadata.get("error"):
            raise ValueError(metadata["error"])
        return markdown, metadata


__all__ = ["DoclingProcessor", "DoclingProcessorOptions"]
