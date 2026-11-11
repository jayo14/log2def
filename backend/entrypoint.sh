#!/bin/sh
set -e

echo "==> Log2Def Backend Service Starting..."

# Apply database migrations
echo "==> Running database migrations..."
python manage.py migrate --noinput

# Collect static files for WhiteNoise
echo "==> Collecting static assets..."
python manage.py collectstatic --noinput --clear 2>/dev/null || python manage.py collectstatic --noinput

PORT="${PORT:-8000}"
WORKERS="${WEB_CONCURRENCY:-1}"
THREADS="${GUNICORN_THREADS:-2}"

echo "==> Starting Gunicorn production server on port ${PORT} with ${WORKERS} worker(s) and ${THREADS} thread(s)..."
exec gunicorn core.wsgi:application \
    --bind "0.0.0.0:${PORT}" \
    --workers "${WORKERS}" \
    --threads "${THREADS}" \
    --worker-class gthread \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile -
