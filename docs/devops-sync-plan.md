# DevOps: Local Environment Sync Plan

> Sync Vercel environment variables + Neon database to local machine.
> Platform: Windows (Git Bash) | Database: Neon PostgreSQL | Hosting: Vercel

---

## Prerequisites

### Required Tools

| Tool | Check Command | Install |
|------|--------------|---------|
| Node.js 18+ | `node --version` | https://nodejs.org |
| npm | `npm --version` | Comes with Node.js |
| Vercel CLI | `vercel --version` | `npm i -g vercel` |
| PostgreSQL Client (pg_dump, psql) | `pg_dump --version` | https://www.postgresql.org/download/windows/ (select "Command Line Tools" only) |

---

## Phase 1: Vercel CLI Setup

### Step 1.1 — Install Vercel CLI
```bash
npm i -g vercel
vercel --version
```
- [x] Vercel CLI installed and version confirmed (v50.42.0)

### Step 1.2 — Authenticate
```bash
vercel login
```
- Opens browser for OAuth login
- [x] Login successful (logged in as aleem313-4547)

### Step 1.3 — Link Project
```bash
cd /c/laragon/www/sales-dashboard
vercel link
```
- Select existing project when prompted
- Creates `.vercel/` directory locally
- [x] Project linked (`.vercel/project.json` exists)

**Verification:**
```bash
ls .vercel/project.json && echo "PASS: Project linked" || echo "FAIL: Not linked"
```

---

## Phase 2: Environment Variables Export

### Step 2.1 — List All Environment Variables
```bash
vercel env ls
```
- Review which variables exist across environments (Production / Preview / Development)
- [x] Variable list reviewed

### Step 2.2 — Pull Production Environment
```bash
vercel env pull .env.local --environment production
```
- [x] `.env.local` created with production variables (30 lines)

### Step 2.3 — Pull Other Environments (Optional)
```bash
# Preview environment
vercel env pull .env.preview --environment preview

# Development environment
vercel env pull .env.development --environment development
```
- [ ] Additional env files created (if needed)

### Step 2.4 — Verify Environment File
```bash
# Check file exists and has content
test -f .env.local && echo "PASS: $(wc -l < .env.local) lines" || echo "FAIL: missing"

# Confirm critical variables are present
grep -q 'DATABASE_URL' .env.local && echo "PASS: DATABASE_URL found" || echo "FAIL: DATABASE_URL missing"
grep -q 'NEXTAUTH_SECRET' .env.local && echo "PASS: NEXTAUTH_SECRET found" || echo "FAIL: missing"
grep -q 'AUTH_SECRET' .env.local && echo "PASS: AUTH_SECRET found" || echo "FAIL: missing"
```
- [x] `.env.local` contains all expected variables (DATABASE_URL, AUTH_SECRET confirmed)

### Step 2.5 — Confirm Gitignore
```bash
grep -q '.env' .gitignore && echo "PASS: .env in .gitignore" || echo "WARNING: Add .env* to .gitignore!"
```
- [x] `.env*` patterns are in `.gitignore` (already configured in this repo)

---

## Phase 3: Neon Database Dump

### Step 3.1 — Load Connection String
```bash
# Extract DATABASE_URL from env file
DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d'=' -f2- | tr -d '"' | tr -d "'")
echo "$DATABASE_URL" | sed 's/:.*@/:***@/'  # Print masked URL to verify
```
- [x] DATABASE_URL loaded and looks correct (Neon pooler endpoint confirmed)

### Step 3.2 — Test Database Connectivity
```bash
psql "$DATABASE_URL" -c "SELECT current_database(), current_user, version();"
```
- [ ] Connection blocked — Neon data transfer quota exceeded. Pending reset.

### Step 3.3 — Create Backup Directory
```bash
mkdir -p backups
```
- [x] `backups/` directory exists

### Step 3.4 — Run Full Database Dump
```bash
# Option A: Compressed custom format (recommended — smaller, supports selective restore)
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f backups/neon_backup_$(date +%Y%m%d_%H%M%S).dump

# Option B: Plain SQL (human-readable, larger file)
pg_dump "$DATABASE_URL" --no-owner --no-privileges -f backups/neon_backup_$(date +%Y%m%d_%H%M%S).sql
```
- [ ] Dump file created in `backups/` — pending Neon quota reset

### Step 3.5 — Verify Dump Integrity
```bash
# For custom format (.dump)
pg_restore -l backups/neon_backup_*.dump | head -30
echo "Tables found: $(pg_restore -l backups/neon_backup_*.dump | grep 'TABLE' | wc -l)"

# For SQL format (.sql)
ls -lh backups/neon_backup_*.sql
echo "Tables found: $(grep -c 'CREATE TABLE' backups/neon_backup_*.sql)"
```
- [ ] Dump contains expected tables — pending Neon quota reset

### Step 3.6 — Optional: Dump Without Cache Table
```bash
# Exclude stats_cache (regenerated automatically, saves space)
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges \
  --exclude-table=stats_cache \
  -f backups/neon_backup_slim_$(date +%Y%m%d_%H%M%S).dump
```

---

## Phase 4: Final Verification

### Step 4.1 — Environment Checklist
```bash
echo "=== Local Sync Verification ==="

# Env file
test -f .env.local \
  && echo "PASS: .env.local exists ($(wc -l < .env.local) lines)" \
  || echo "FAIL: .env.local missing"

# Database dump
LATEST_DUMP=$(ls -t backups/neon_backup_*.dump 2>/dev/null | head -1)
test -n "$LATEST_DUMP" \
  && echo "PASS: DB dump exists — $LATEST_DUMP ($(ls -lh "$LATEST_DUMP" | awk '{print $5}'))" \
  || echo "FAIL: No database dump found"

# Git safety
grep -q '.env' .gitignore \
  && echo "PASS: .env in .gitignore" \
  || echo "WARN: .env NOT in .gitignore"
grep -q 'backups' .gitignore \
  && echo "PASS: backups/ in .gitignore" \
  || echo "WARN: backups/ NOT in .gitignore"

# DB connectivity
DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d'=' -f2- | tr -d '"' | tr -d "'")
psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1 \
  && echo "PASS: Database connection works" \
  || echo "FAIL: Cannot connect to database"

echo "=== Done ==="
```
- [ ] All checks PASS — pending Neon quota reset for full verification

### Local Database Setup (Completed)
- [x] Local PostgreSQL 14.5 running via Laragon
- [x] `sales_dashboard` database created
- [x] Base schema applied (agents, profiles, jobs, sync_log, stats_cache, alerts + views)
- [x] Migration 004 — Cyberpunk schema (connects, priority, niche)
- [x] Migration 005 — Agent passwords
- [x] Migration 006 — Task management (18 tables, triggers, indexes)
- [x] Migration 007 — Fix activity_log trigger
- [x] Migration 010 — Profile platform column
- [x] Migration 011 — Fix profile assignments
- [x] Migration 012 — Remove ClickUp dependency
- [x] Migration 013 — Lifecycle milestones
- [x] 24 tables total verified
- [x] pgAdmin 4 connected and tables visible

---

## Phase 5: Automation Script

The automation script is already created at `scripts/sync-prod.sh`.

### Usage
```bash
bash scripts/sync-prod.sh
```

### What It Does
1. Pulls latest env variables from Vercel (production)
2. Loads DATABASE_URL from `.env.local`
3. Creates compressed database dump in `backups/`
4. Cleans up old backups (keeps last 5)

### Schedule It (Optional)
```bash
# Run weekly via Windows Task Scheduler or cron:
# Every Monday at 9am
0 9 * * 1 cd /c/laragon/www/sales-dashboard && bash scripts/sync-prod.sh >> backups/sync.log 2>&1
```

---

## Phase 6: Local PostgreSQL Configuration

### Step 6.1 — Environment File Setup
- `.env.local` contains both Neon (commented out) and local PostgreSQL (active)
- `.env.neon` is a full backup of the original Vercel env pull
- To switch to Neon: comment out the LOCAL block, uncomment the NEON block in `.env.local`
- To switch to local: reverse the above

### Step 6.2 — Local Connection Details
```
Host:     localhost
Port:     5432
User:     postgres
Password: (empty)
Database: sales_dashboard
URL:      postgresql://postgres@localhost:5432/sales_dashboard
```

### Step 6.3 — Run Dev Server
```bash
npm install    # first time only
npm run dev    # starts on http://localhost:3000
```

---

## Phase 7: Neon Database Dump (Run When Quota Resets)

When Neon data transfer quota resets, run these commands to dump production data and restore it locally.

### Quick Command (just say "get dump")
```bash
# 1. Switch to Neon connection temporarily
export PATH=$PATH:"/c/laragon/bin/postgresql/postgresql-17/bin"
NEON_URL="postgresql://neondb_owner:npg_QpjWIwi8CRh0@ep-late-darkness-aix89pvz-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"

# 2. Test Neon connectivity
psql "$NEON_URL" -c "SELECT 1;"

# 3. Dump from Neon
mkdir -p backups
pg_dump "$NEON_URL" -Fc --no-owner --no-privileges -f backups/neon_backup_$(date +%Y%m%d_%H%M%S).dump

# 4. Drop and recreate local database (fresh restore)
psql -U postgres -h localhost -c "DROP DATABASE IF EXISTS sales_dashboard;"
psql -U postgres -h localhost -c "CREATE DATABASE sales_dashboard;"

# 5. Restore dump to local
pg_restore -U postgres -h localhost -d sales_dashboard --no-owner --no-privileges backups/neon_backup_*.dump

# 6. Verify
psql -U postgres -h localhost -d sales_dashboard -c "SELECT count(*) FROM jobs;"
psql -U postgres -h localhost -d sales_dashboard -c "SELECT count(*) FROM tasks;"
psql -U postgres -h localhost -d sales_dashboard -c "SELECT count(*) FROM agents;"
```

### Or Use the Automation Script
```bash
bash scripts/sync-prod.sh
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `vercel: command not found` | Run `npm i -g vercel`, then restart Git Bash |
| `pg_dump: command not found` | Install PostgreSQL client tools, add to PATH: `export PATH=$PATH:"/c/Program Files/PostgreSQL/17/bin"` |
| `SSL connection required` | Neon requires SSL — the `?sslmode=require` in DATABASE_URL handles this. If not present, append it |
| `permission denied` on dump | Use `--no-owner --no-privileges` flags (already included above) |
| `source .env.local` fails | Use the `grep + cut` method instead (Step 3.1) — Git Bash can choke on complex env files |
| Dump is very slow | Exclude large cache tables: `--exclude-table=stats_cache` |
| `vercel env pull` shows 0 vars | Check you're linked to the correct project: `cat .vercel/project.json` |
| Multiple DATABASE_URLs | Neon pooled vs direct — use the **pooled** URL for reads, **direct** for dumps. Check Neon dashboard |

---

## Quick Reference

| Task | Command |
|------|---------|
| Full sync (automated) | `bash scripts/sync-prod.sh` |
| Pull prod env only | `vercel env pull .env.local --environment production` |
| List Vercel env vars | `vercel env ls` |
| DB dump (compressed) | `pg_dump "$DATABASE_URL" -Fc -f backups/backup.dump` |
| DB dump (SQL) | `pg_dump "$DATABASE_URL" -f backups/backup.sql` |
| Test DB connection | `psql "$DATABASE_URL" -c "SELECT 1;"` |
| Restore to local DB | `pg_restore -d local_db_name backups/backup.dump` |
| View dump contents | `pg_restore -l backups/backup.dump` |
