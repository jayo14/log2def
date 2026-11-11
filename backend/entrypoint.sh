#!/bin/sh
set -e

echo "==> Log2Def Backend Service Starting..."

# Apply database migrations with retry in case database service is initializing
echo "==> Running database migrations..."
MAX_TRIES=5
COUNT=0
until python manage.py migrate --noinput || [ $COUNT -ge $MAX_TRIES ]; do
  COUNT=$((COUNT + 1))
  echo "Migration attempt $COUNT/$MAX_TRIES failed, retrying in 3 seconds..."
  sleep 3
done

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
