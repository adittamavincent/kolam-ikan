import json
import logging
from pathlib import Path
from typing import Any, Tuple
import yaml # type: ignore
import pandas as pd # type: ignore
try:
    import html2text  # type: ignore[import]
except Exception:
    html2text = None

logger = logging.getLogger("text_converter")

def convert_text(file_path: Path, content_type: str, file_name: str, options: Any) -> Tuple[str, dict[str, Any]]:
    try:
        ext = file_name.lower().split('.')[-1] if '.' in file_name else ""
        ctype = (content_type or "").lower()
        
        text_content = ""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                text_content = f.read()
        except UnicodeDecodeError:
            class TextDecodeError(Exception): pass
            raise TextDecodeError("Failed to decode text file as UTF-8.")
            
        md_text = ""
        
        if ctype == "text/csv" or ext == "csv":
            try:
                df = pd.read_csv(file_path)
                md_text = df.to_markdown(index=False)
            except Exception:
                md_text = f"```csv\n{text_content}\n```"
                
        elif ctype == "application/json" or ext == "json":
            try:
                # Validate and pretty print
                obj = json.loads(text_content)
                md_text = f"```json\n{json.dumps(obj, indent=2)}\n```"
            except Exception:
                md_text = f"```json\n{text_content}\n```"
                
        elif ctype in ["application/x-yaml", "text/yaml"] or ext in ["yaml", "yml"]:
            try:
                # Validate and pretty print
                obj = yaml.safe_load(text_content)
                md_text = f"```yaml\n{yaml.dump(obj, sort_keys=False)}\n```"
            except Exception:
                md_text = f"```yaml\n{text_content}\n```"
                
        elif ctype == "text/html" or ext in ["html", "htm"]:
            if html2text is None:
                md_text = text_content
            else:
                h = html2text.HTML2Text()
                h.ignore_links = False
                md_text = h.handle(text_content)
            
        else: # TXT, MD, etc.
            md_text = text_content

        metadata = {
            "inputFormat": "text",
            "charCount": len(md_text),
            "originalType": ctype or ext
        }

        return md_text, metadata

    except Exception as e:
        logger.exception("Error in text_converter")
        return "", {"error": str(e)}
