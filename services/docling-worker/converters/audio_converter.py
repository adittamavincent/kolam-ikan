import logging
import threading
from pathlib import Path
from typing import Any, Tuple

try:
    import whisper  # type: ignore
except ImportError:
    whisper = None

logger = logging.getLogger("audio_converter")

_WHISPER_MODEL = None
_WHISPER_LOCK = threading.Lock()

def _get_whisper_model(model_size: str = "base"):
    global _WHISPER_MODEL
    # We only cache one model at a time for simplicity. 
    # If a different size is requested and we loaded 'base', we'll just reload or use what's loaded.
    with _WHISPER_LOCK:
        if _WHISPER_MODEL is None or getattr(_WHISPER_MODEL, "_model_name", "") != model_size:
            if whisper is None:
                raise ImportError("openai-whisper is not installed.")
            _WHISPER_MODEL = whisper.load_model(model_size)
            # monkey patch to track the model name for cache invalidation if needed
            if hasattr(_WHISPER_MODEL, "_model_name") is False:
                setattr(_WHISPER_MODEL, "_model_name", model_size)
        return _WHISPER_MODEL

def convert_audio(file_path: Path, content_type: str, file_name: str, options: Any) -> Tuple[str, dict[str, Any]]:
    try:
        if whisper is None:
            return "", {"error": "openai-whisper not installed natively."}

        model_size = getattr(options, "whisperModel", "base")
        model = _get_whisper_model(model_size)
        
        # We can extract language and split on silence if word timestamps are enabled
        # Whisper word timestamps are available from "word_timestamps=True"
        result = model.transcribe(str(file_path), word_timestamps=True)
        
        md_text = f"# Audio Transcription: {file_name}\n\n"
        
        segments = result.get("segments", [])
        duration = 0.0
        
        for segment in segments:
            start_time = segment.get("start", 0.0)
            end_time = segment.get("end", 0.0)
            text = segment.get("text", "").strip()
            
            if end_time > duration:
                duration = end_time
                
            time_fmt = f"[{start_time:.1f}s -> {end_time:.1f}s]"
            md_text += f"**{time_fmt}** {text}\n\n"
            
        metadata = {
            "inputFormat": "audio",
            "durationSeconds": duration,
            "language": result.get("language", "unknown"),
            "whisperModel": model_size
        }

        return md_text.strip(), metadata

    except Exception as e:
        logger.exception("Error in audio_converter")
        return "", {"error": str(e)}
