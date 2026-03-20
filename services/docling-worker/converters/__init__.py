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
    office_types = [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/epub+zip",
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint"
    ]
    office_exts = (".docx", ".pptx", ".xlsx", ".epub", ".odt", ".doc", ".ppt", ".xls")
    if ctype in office_types or file_name.lower().endswith(office_exts):
        return convert_office(file_path, content_type, file_name, options)

    # Images
    image_types = ["image/png", "image/jpeg", "image/tiff", "image/webp", "image/jpg"]
    image_exts = (".png", ".jpeg", ".jpg", ".tiff", ".webp")
    if ctype in image_types or file_name.lower().endswith(image_exts):
        return convert_image(file_path, content_type, file_name, options)

    # Audio
    audio_types = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg", "audio/m4a", "video/mp4"]
    audio_exts = (".mp3", ".wav", ".mp4", ".ogg", ".m4a")
    if ctype in audio_types or file_name.lower().endswith(audio_exts):
        return convert_audio(file_path, content_type, file_name, options)

    # Text / JSON / CSV / YAML / MD (fallback to text)
    text_types = [
        "text/plain", "text/markdown", "text/html", "text/csv", 
        "application/json", "application/x-yaml", "text/yaml"
    ]
    text_exts = (".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".html", ".htm")
    if ctype in text_types or file_name.lower().endswith(text_exts):
        return convert_text(file_path, content_type, file_name, options)

    # Fallback
    logger.warning("Unknown content type '%s' for file '%s', falling back to text converter", ctype, file_name)
    return convert_text(file_path, content_type, file_name, options)
