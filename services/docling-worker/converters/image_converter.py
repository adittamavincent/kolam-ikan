import logging
from pathlib import Path
from typing import Any, Tuple
from PIL import Image, ImageEnhance # type: ignore
try:
    import pytesseract  # type: ignore[import]
except Exception:
    pytesseract = None

logger = logging.getLogger("image_converter")

def convert_image(file_path: Path, content_type: str, file_name: str, options: Any) -> Tuple[str, dict[str, Any]]:
    try:
        ocr_lang = getattr(options, "ocrLang", "ind")
        
        with Image.open(file_path) as img:
            # Pre-process: convert to grayscale
            img = img.convert('L')
            # Sharpen
            enhancer = ImageEnhance.Sharpness(img)
            img = enhancer.enhance(2.0)
            
            if pytesseract is None:
                raise RuntimeError("pytesseract is not available in this environment")
            text = pytesseract.image_to_string(img, lang=ocr_lang)
            
        md_text = text.strip()
        word_count = len(md_text.split())
        
        metadata = {
            "inputFormat": "image",
            "ocrLang": ocr_lang,
            "estimatedWordCount": word_count
        }

        return md_text, metadata

    except Exception as e:
        logger.exception("Error in image_converter")
        return "", {"error": str(e)}
