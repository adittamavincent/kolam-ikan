import logging
from pathlib import Path
from typing import Any, Tuple
import json
import httpx
try:
    import html2text  # type: ignore[import]
except Exception:
    html2text = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

logger = logging.getLogger("web_converter")

def convert_web(file_path: Path, content_type: str, file_name: str, options: Any) -> Tuple[str, dict[str, Any]]:
    # In our worker architecture, `file_path` might contain the bytes of the URL string if it was downloaded as a "file",
    # or the caller might have just passed the URL as the file_name.
    # The prompt architecture states: "Handles content_type='text/url' or file_name starting with http(s)".
    try:
        url = ""
        # Often the content of the "file" holds the actual URL if it was uploaded as text/url.
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content.startswith("http://") or content.startswith("https://"):
                url = content
        
        if not url:
            if file_name.startswith("http://") or file_name.startswith("https://"):
                url = file_name
            else:
                return "", {"error": "Could not identify URL"}

        strip_boilerplate = getattr(options, "webStripBoilerplate", True)

        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()
            
            final_ctype = response.headers.get("Content-Type", "").lower()
            html_content = response.text
            fetched_bytes = len(response.content)

        if "text/html" in final_ctype:
            if strip_boilerplate and BeautifulSoup:
                soup = BeautifulSoup(html_content, "html.parser")
                for tag in soup(["nav", "footer", "aside", "script", "style"]):
                    tag.decompose()
                html_content = str(soup)
            if html2text is None:
                md_text = html_content
            else:
                h = html2text.HTML2Text()
                h.ignore_links = False
                md_text = h.handle(html_content)
        elif "application/json" in final_ctype:
            try:
                obj = json.loads(html_content)
                md_text = f"```json\n{json.dumps(obj, indent=2)}\n```"
            except Exception:
                md_text = f"```json\n{html_content}\n```"
        else:
            md_text = html_content # fallback to plain text

        metadata = {
            "sourceUrl": url,
            "finalContentType": final_ctype,
            "fetchedBytes": fetched_bytes,
            "inputFormat": "web"
        }

        return md_text, metadata

    except Exception as e:
        logger.exception("Error in web_converter")
        return "", {"error": str(e)}
