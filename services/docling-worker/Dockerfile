FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ghostscript \
      libgl1 \
      libglib2.0-0 \
      libsm6 \
      libxext6 \
      libxrender1 \
      poppler-utils \
      ffmpeg \
      tesseract-ocr \
      tesseract-ocr-ind \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip "setuptools<70.0.0" wheel \
    && pip install --no-cache-dir --no-build-isolation openai-whisper==20240930 \
    && pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
COPY docling_processor.py /app/docling_processor.py
COPY progress_tracker.py /app/progress_tracker.py
COPY converters /app/converters

EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
