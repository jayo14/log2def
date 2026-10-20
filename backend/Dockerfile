# Multi-stage/Optimized Production Dockerfile for Log2Def Backend
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    LIBREOFFICE_PATH=/usr/bin/libreoffice \
    TESSERACT_CMD=/usr/bin/tesseract

WORKDIR /app

# Install system dependencies for OCR, document conversion, and database
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend project code
COPY . /app/

# Make entrypoint script executable
RUN chmod +x /app/entrypoint.sh

# Create static and media directories
RUN mkdir -p /app/staticfiles /app/media

EXPOSE ${PORT}

ENTRYPOINT ["/app/entrypoint.sh"]
