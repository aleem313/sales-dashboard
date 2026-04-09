#!/bin/sh
# Automated PostgreSQL backup script
# Usage: Add to crontab: 0 2 * * * /opt/sales-dashboard/docker/scripts/backup-db.sh
set -e

BACKUP_DIR="/opt/sales-dashboard/backups"
COMPOSE_FILE="/opt/sales-dashboard/docker-compose.prod.yml"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sales_dashboard_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting database backup..."

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-sales_user}" -d "${POSTGRES_DATABASE:-sales_dashboard}" \
  | gzip > "$BACKUP_FILE"

echo "[$(date)] Backup saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "sales_dashboard_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days."
