#!/bin/sh
# Wait for PostgreSQL to be ready before starting the app
set -e

HOST="${POSTGRES_HOST:-postgres}"
PORT="${POSTGRES_PORT:-5432}"
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "Waiting for PostgreSQL at $HOST:$PORT..."

retries=0
until pg_isready -h "$HOST" -p "$PORT" -q 2>/dev/null; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$MAX_RETRIES" ]; then
    echo "ERROR: PostgreSQL not ready after $MAX_RETRIES retries. Exiting."
    exit 1
  fi
  echo "PostgreSQL not ready yet (attempt $retries/$MAX_RETRIES)..."
  sleep "$RETRY_INTERVAL"
done

echo "PostgreSQL is ready!"
exec "$@"
