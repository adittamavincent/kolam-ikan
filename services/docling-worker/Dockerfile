FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu

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
# Force CPU-only PyTorch so Railway does not pull the multi-GB CUDA wheels.
RUN pip install --upgrade pip "setuptools<70.0.0" wheel \
    && pip install \
      torch==2.5.1+cpu \
      torchvision==0.20.1+cpu \
    && pip install --no-build-isolation openai-whisper==20240930 \
    && pip install -r /app/requirements.txt

COPY app.py /app/app.py
COPY docling_processor.py /app/docling_processor.py
COPY progress_tracker.py /app/progress_tracker.py
COPY converters /app/converters

EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
