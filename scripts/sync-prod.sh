#!/bin/bash
# sync-prod.sh — Pull Vercel env + Neon database dump
# Usage: bash scripts/sync-prod.sh

set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== Rising Lions Production Sync ==="
echo ""

# Step 1: Pull env variables
echo "[1/4] Pulling environment variables from Vercel..."
vercel env pull .env.local --yes 2>/dev/null || vercel env pull .env.local
echo "  ✓ .env.local updated ($(wc -l < .env.local) lines)"

# Step 2: Load DATABASE_URL
echo "[2/4] Loading database connection string..."
DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$DATABASE_URL" ]; then
  echo "  ✗ DATABASE_URL not found in .env.local"
  exit 1
fi
echo "  ✓ DATABASE_URL loaded"

# Step 3: Database dump
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/neon_backup_${TIMESTAMP}.dump"
echo "[3/4] Dumping Neon database..."
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$DUMP_FILE"
DUMP_SIZE=$(ls -lh "$DUMP_FILE" | awk '{print $5}')
echo "  ✓ Dump saved: $DUMP_FILE ($DUMP_SIZE)"

# Step 4: Cleanup old backups (keep last 5)
echo "[4/4] Cleaning up old backups..."
ls -t "$BACKUP_DIR"/neon_backup_*.dump 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
BACKUP_COUNT=$(ls "$BACKUP_DIR"/neon_backup_*.dump 2>/dev/null | wc -l)
echo "  ✓ $BACKUP_COUNT backup(s) retained"

echo ""
echo "=== Sync complete ==="
echo "  Env:    .env.local"
echo "  Backup: $DUMP_FILE"
