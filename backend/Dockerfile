# Multi-stage / Optimized Production Dockerfile for Log2Def Backend
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    LIBREOFFICE_PATH=/usr/bin/libreoffice \
    TESSERACT_CMD=/usr/bin/tesseract

WORKDIR /app

# Install system dependencies for OCR, document conversion, fonts, and database
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    tesseract-ocr \
    tesseract-ocr-eng \
    fonts-liberation \
    fonts-dejavu-core \
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

# Make entrypoint script executable and ensure runtime folders exist
RUN chmod +x /app/entrypoint.sh && \
    mkdir -p /app/staticfiles /app/media

EXPOSE ${PORT}

# Zero-overhead health check hitting the Django health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://127.0.0.1:${PORT}/health/ || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
