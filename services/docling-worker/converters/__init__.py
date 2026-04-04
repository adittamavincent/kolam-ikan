import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Tuple

from .pdf_converter import convert_pdf # type: ignore
from .office_converter import convert_office # type: ignore
from .text_converter import convert_text # type: ignore
from .image_converter import convert_image # type: ignore
from .audio_converter import convert_audio # type: ignore
from .web_converter import convert_web # type: ignore

if TYPE_CHECKING:
    from progress_tracker import PageProgress # type: ignore

logger = logging.getLogger("converters")

OFFICE_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/epub+zip",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
}
OFFICE_EXTS = (".docx", ".pptx", ".xlsx", ".epub", ".odt", ".ods", ".odp", ".doc", ".ppt", ".xls")

IMAGE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/tiff",
    "image/webp",
    "image/gif",
    "image/bmp",
}
IMAGE_EXTS = (".png", ".jpeg", ".jpg", ".tiff", ".tif", ".webp", ".gif", ".bmp")

AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/mpga",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm", ".flac", ".mp4", ".m4v", ".mov")

TEXT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "application/json",
    "application/x-yaml",
    "text/yaml",
}
TEXT_EXTS = (".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".html", ".htm")

def convert_to_markdown(
    file_path: Path,
    content_type: str,
    file_name: str,
    options: Any,
    on_progress: Callable[["PageProgress"], None] | None = None,
) -> Tuple[str, dict[str, Any]]:
    """Dispatches to the correct converter based on content type."""
    ctype = (content_type or "").lower()
    
    # Text / URL
    if ctype == "text/url" or str(file_name).startswith("http://") or str(file_name).startswith("https://"):
        return convert_web(file_path, content_type, file_name, options)

    # PDF
    if ctype == "application/pdf" or file_name.lower().endswith(".pdf"):
        return convert_pdf(file_path, content_type, file_name, options, on_progress=on_progress)

    # Office
    if ctype in OFFICE_TYPES or file_name.lower().endswith(OFFICE_EXTS):
        return convert_office(file_path, content_type, file_name, options)

    # Images
    if ctype in IMAGE_TYPES or file_name.lower().endswith(IMAGE_EXTS):
        return convert_image(file_path, content_type, file_name, options)

    # Audio
    if ctype in AUDIO_TYPES or file_name.lower().endswith(AUDIO_EXTS):
        return convert_audio(file_path, content_type, file_name, options)

    # Text / JSON / CSV / YAML / MD (fallback to text)
    if ctype in TEXT_TYPES or file_name.lower().endswith(TEXT_EXTS):
        return convert_text(file_path, content_type, file_name, options)

    # Fallback
    logger.warning("Unknown content type '%s' for file '%s', falling back to text converter", ctype, file_name)
    return convert_text(file_path, content_type, file_name, options)
