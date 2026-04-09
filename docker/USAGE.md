# Docker Usage Guide — Rising Lions Analytics Dashboard

## Prerequisites

- **Docker Desktop** installed and running
- **Port 5432** free (stop Laragon PostgreSQL before starting Docker)
- **Port 3000** free (stop any running `npm run dev` process)

### How to Free Ports

```bash
# Check if port 5432 is in use
netstat -ano | grep ":5432"

# Check if port 3000 is in use
netstat -ano | grep ":3000"

# Stop Laragon PostgreSQL: Open Laragon → right-click PostgreSQL → Stop
# Stop npm run dev: Ctrl+C in the terminal running it
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                  Docker Network                   │
│                                                  │
│  ┌──────────┐         ┌──────────────────────┐   │
│  │ postgres │ :5432 ← │        app           │   │
│  │ (PG 16)  │         │  (Next.js 16 + Node) │   │
│  └──────────┘         └──────────────────────┘   │
│       │                        │                  │
└───────│────────────────────────│──────────────────┘
        │                        │
   host:5432                host:3000
  (DB tools)              (browser)
```

**Production adds:**
```
┌────────────────────────────────────────────────────────┐
│                   Docker Network                        │
│                                                        │
│  ┌────────┐   ┌──────┐   ┌──────────┐   ┌─────────┐  │
│  │certbot │   │nginx │ → │   app    │ → │postgres │  │
│  │(SSL)   │   │:80/443│   │  :3000   │   │ :5432   │  │
│  └────────┘   └──────┘   └──────────┘   └─────────┘  │
│                  │                                      │
└──────────────────│─────────────────────────────────────┘
              host:80/443
             (public web)
```

---

## File Structure

```
sales-dashboard/
├── Dockerfile.dev              # Dev image — copies source, installs deps
├── Dockerfile.prod             # Production — multi-stage, non-root, ~150MB
├── docker-compose.yml          # Local dev: app + postgres
├── docker-compose.prod.yml     # Production: app + postgres + nginx + certbot
├── .dockerignore               # Excludes .git, node_modules, .next from build
├── .env.docker                 # Docker env vars (DB points to container)
├── .env.docker.example         # Template for .env.docker
├── docker/
│   ├── USAGE.md                # This file
│   ├── plan.md                 # Detailed implementation plan
│   ├── nginx/
│   │   └── nginx.conf          # Reverse proxy config (SSL, gzip, rate limit)
│   ├── postgres/
│   │   └── init/
│   │       └── 01-schema-and-data.sql  # Full DB dump (auto-loaded on first start)
│   └── scripts/
│       ├── healthcheck.sh      # Container health check
│       ├── wait-for-db.sh      # Wait for PG before app starts
│       └── backup-db.sh        # Automated DB backup with 7-day retention
└── .github/
    └── workflows/
        └── deploy.yml          # CI/CD: lint → build → push → deploy via SSH
```

---

## Environment Files

The project has multiple env files for different contexts:

| File | Purpose | Used By |
|------|---------|---------|
| `.env.local` | Laragon/native `npm run dev` | Next.js (direct development) |
| `.env.docker` | Docker development | Docker Compose (mounted as `.env.local` in container) |
| `.env.production` | Production server | Docker Compose prod |
| `.env.docker.example` | Template | Copy to create `.env.docker` or `.env.production` |

**Key difference:** `.env.docker` has `POSTGRES_HOST=postgres` (Docker container hostname) while `.env.local` has `POSTGRES_HOST=localhost` (Laragon).

### How DB Connection Works

The app's `src/lib/db.ts` auto-detects the environment:
- If `POSTGRES_HOST` is `localhost`, `127.0.0.1`, `postgres`, or any hostname without a dot → uses **`pg` Pool** (direct PostgreSQL connection)
- If `POSTGRES_HOST` contains a dot (e.g., `*.neon.tech`) → uses **`@vercel/postgres`** (Neon serverless driver)

This means Docker, Laragon, and Vercel all work without code changes.

---

## Local Development

### First-Time Setup

```bash
# 1. Navigate to project root
cd C:\laragon\www\sales-dashboard

# 2. Stop Laragon PostgreSQL (port 5432 conflict)
#    Laragon UI → right-click PostgreSQL → Stop

# 3. Stop any running npm run dev (port 3000 conflict)

# 4. Create your Docker environment file
cp .env.docker.example .env.docker
# Edit .env.docker with your actual credentials

# 5. Build and start containers
docker compose up --build

# 6. Wait for output:
#    ✓ Ready in ~3s
#    App is now running at http://localhost:3000
```

### Daily Development

```bash
# Start containers (no rebuild needed unless code or deps changed)
docker compose up

# Start in background (detached mode)
docker compose up -d

# View logs when running in background
docker compose logs -f app        # App logs only
docker compose logs -f postgres   # DB logs only
docker compose logs -f            # All logs
```

### After Code Changes

Source code is **copied into the image** (not mounted as a volume) because Windows Docker volume mounts are extremely slow for file I/O — Turbopack compilation took 10+ minutes with volume mounts vs ~3 seconds with copied source.

```bash
# Rebuild after ANY code change (source, deps, config)
docker compose up --build

# Rebuild only the app (faster — skips postgres)
docker compose up --build app
```

**Tip:** For rapid iteration during development, you may prefer running `npm run dev` directly with Laragon PostgreSQL. Use Docker for:
- Testing the full stack with a clean database
- Testing production-like builds
- Onboarding new developers (zero local setup)

### Stop Containers

```bash
# Stop containers (database data preserved)
docker compose down

# Stop and DELETE all database data (full reset)
docker compose down -v
```

### Database Access

```bash
# Connect from your host machine (pgAdmin, DBeaver, or psql)
psql -h localhost -U sales_user -d sales_dashboard
# Password: sales_pass (or whatever you set in .env.docker)

# Connect from inside the postgres container
docker compose exec postgres psql -U sales_user -d sales_dashboard

# Run a quick query
docker compose exec postgres psql -U sales_user -d sales_dashboard \
  -c "SELECT count(*) FROM agents;"

# List all tables
docker compose exec postgres psql -U sales_user -d sales_dashboard \
  -c "\dt"
```

### Run Database Migrations

Open in browser:
```
http://localhost:3000/api/migrate?v=013&secret=YOUR_CRON_SECRET
```

Replace `013` with the migration version and the secret with your `CRON_SECRET` from `.env.docker`.

### Reset Database (Start Fresh)

```bash
# This deletes the PostgreSQL volume and re-initializes from the dump
docker compose down -v
docker compose up --build
```

The `01-schema-and-data.sql` dump runs automatically on first start, creating all 24 tables with seed data (5 agents, 8 profiles, 26 columns, 2 projects).

### Shell Access

```bash
# Shell into the app container
docker compose exec app sh

# Shell into the PostgreSQL container
docker compose exec postgres sh
```

### Health Check

```bash
# Basic health check (app is running)
curl http://localhost:3000/api/health
# → {"status":"ok","timestamp":"...","uptime":123.45}

# Deep health check (app + database connectivity)
curl http://localhost:3000/api/health?db=true
# → {"status":"ok","timestamp":"...","uptime":123.45,"database":"connected"}
```

---

## Production Deployment

### Server Prerequisites

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 LTS |

```bash
# Install Docker Engine (Ubuntu/Debian — NOT Docker Desktop)
curl -fsSL https://get.docker.com | sh

# Add your user to docker group (avoids sudo)
sudo usermod -aG docker $USER
# Log out and back in for this to take effect

# Install Git
sudo apt install git -y

# Configure firewall — ONLY open these ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
# Do NOT open 3000 or 5432 — they stay internal to Docker
```

### First-Time Server Setup

```bash
# 1. Clone the repository
sudo mkdir -p /opt/sales-dashboard
sudo chown $USER:$USER /opt/sales-dashboard
git clone https://github.com/YOUR_ORG/sales-dashboard.git /opt/sales-dashboard
cd /opt/sales-dashboard

# 2. Create production environment file
cp .env.docker.example .env.production
nano .env.production
# IMPORTANT: Set strong, unique values for:
#   POSTGRES_PASSWORD — long random string (openssl rand -hex 32)
#   AUTH_SECRET       — openssl rand -base64 32
#   CRON_SECRET       — openssl rand -hex 16
#   N8N_WEBHOOK_SECRET — openssl rand -hex 16
#   Update POSTGRES_URL to match the password you set
#   Set all auth provider keys (GitHub OAuth, etc.)

# 3. Update nginx.conf with your domain
nano docker/nginx/nginx.conf
#   Replace ALL instances of "yourdomain.com" with your actual domain

# 4. Generate SSL certificates

#    Option A: Let's Encrypt (recommended for public servers)
#    First start nginx in HTTP-only mode for ACME challenge:
docker compose -f docker-compose.prod.yml up -d nginx
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d yourdomain.com --email admin@yourdomain.com --agree-tos
docker compose -f docker-compose.prod.yml restart nginx

#    Option B: Self-signed (for testing / internal use)
mkdir -p docker/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/nginx/ssl/privkey.pem \
  -out docker/nginx/ssl/fullchain.pem \
  -subj "/CN=yourdomain.com"

# 5. Start all services
docker compose -f docker-compose.prod.yml up -d

# 6. Wait ~30s for app to start, then run database migrations
curl -f "http://localhost:3000/api/migrate?v=013&secret=YOUR_CRON_SECRET"

# 7. Verify everything is running
docker compose -f docker-compose.prod.yml ps
curl http://localhost:3000/api/health?db=true
```

### Production Management

```bash
# View status of all services
docker compose -f docker-compose.prod.yml ps

# View logs (follow mode)
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f nginx
docker compose -f docker-compose.prod.yml logs -f            # all

# Restart a specific service
docker compose -f docker-compose.prod.yml restart app

# Pull latest code and redeploy
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build

# Stop all services
docker compose -f docker-compose.prod.yml down

# View resource usage (CPU, memory)
docker stats
```

### Database Backup & Restore

```bash
# Manual backup (plain SQL)
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U sales_user -d sales_dashboard > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup (recommended for large databases)
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U sales_user -d sales_dashboard | gzip > backup_$(date +%Y%m%d).sql.gz

# Restore from plain SQL backup
docker compose -f docker-compose.prod.yml exec -i postgres \
  psql -U sales_user -d sales_dashboard < backup_file.sql

# Restore from compressed backup
gunzip -c backup_file.sql.gz | docker compose -f docker-compose.prod.yml exec -i postgres \
  psql -U sales_user -d sales_dashboard

# Automated daily backup at 2:00 AM (add to server crontab)
crontab -e
# Add this line:
# 0 2 * * * /opt/sales-dashboard/docker/scripts/backup-db.sh
```

### SSL Certificate Renewal

Let's Encrypt certificates expire every 90 days. The certbot container auto-renews every 12 hours. To manually trigger:

```bash
docker compose -f docker-compose.prod.yml run --rm certbot renew
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## CI/CD (GitHub Actions)

Deployments are automated via `.github/workflows/deploy.yml`:

| Trigger | Action |
|---------|--------|
| Push to `main` | Auto-deploy to **production** server |
| Push to `staging` | Auto-deploy to **staging** server |
| PR to `main` | Lint + type-check + build only (no deploy) |
| Manual dispatch | Choose environment from GitHub Actions UI |

### Pipeline Flow

```
Push to main
  → Lint (eslint)
  → Type check (tsc --noEmit)
  → Build (next build)
  → Build Docker image
  → Push to GitHub Container Registry (ghcr.io)
  → SSH into server
  → Pull new image
  → Restart containers
  → Health check (auto-rollback on failure)
  → Slack notification (optional)
```

### Required GitHub Secrets

Go to **GitHub repo → Settings → Secrets and variables → Actions** and add:

| Secret | Value | Required |
|--------|-------|----------|
| `PROD_SSH_HOST` | Production server IP or hostname | Yes |
| `PROD_SSH_USER` | SSH username on server | Yes |
| `PROD_SSH_KEY` | SSH private key content | Yes |
| `PROD_SSH_PORT` | SSH port (default: 22) | No |
| `PROD_DEPLOY_PATH` | `/opt/sales-dashboard` | Yes |
| `PROD_ENV_FILE` | Base64-encoded `.env.production` | Yes |
| `PROD_DOMAIN` | Your production domain | Yes |
| `STAGING_SSH_HOST` | Staging server IP | For staging |
| `STAGING_SSH_USER` | Staging SSH username | For staging |
| `STAGING_SSH_KEY` | Staging SSH private key | For staging |
| `STAGING_DEPLOY_PATH` | `/opt/sales-dashboard` | For staging |
| `STAGING_ENV_FILE` | Base64-encoded staging env | For staging |
| `STAGING_DOMAIN` | Staging domain | For staging |
| `SLACK_DEPLOY_WEBHOOK` | Slack incoming webhook URL | Optional |

### Generate Base64 Env File

```bash
# Linux/Mac
cat .env.production | base64 -w 0
# Copy the output → paste as PROD_ENV_FILE secret in GitHub

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".env.production"))
```

### Generate SSH Deploy Key

```bash
# On your local machine — generate a dedicated deploy key
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/github_deploy

# Copy the public key to the server
ssh-copy-id -i ~/.ssh/github_deploy.pub user@your-server-ip

# Copy the PRIVATE key content — this goes into PROD_SSH_KEY secret
cat ~/.ssh/github_deploy
# Copy everything including "-----BEGIN OPENSSH PRIVATE KEY-----" lines
```

### Rollback

```bash
# Option 1: Git revert (triggers auto-redeploy)
git revert HEAD
git push origin main

# Option 2: Manual rollback on server (use previous Docker image)
ssh user@server
cd /opt/sales-dashboard
docker compose -f docker-compose.prod.yml down
git checkout HEAD~1
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Switching Between Docker and Native Development

### Switch to Docker

```bash
# 1. Stop Laragon PostgreSQL
# 2. Stop npm run dev
# 3. Start Docker
docker compose up --build
```

### Switch Back to Native (Laragon)

```bash
# 1. Stop Docker containers
docker compose down

# 2. Start Laragon PostgreSQL
# 3. Run npm run dev as usual
npm run dev
```

Both modes use the same codebase and database schema. The only difference is which PostgreSQL instance the app connects to (Docker container vs Laragon).

---

## Quick Reference

| Task | Command |
|------|---------|
| **Development** | |
| Start dev | `docker compose up --build` |
| Start dev (background) | `docker compose up --build -d` |
| Stop dev | `docker compose down` |
| Reset DB | `docker compose down -v && docker compose up --build` |
| Rebuild after code change | `docker compose up --build` |
| View app logs | `docker compose logs -f app` |
| DB shell | `docker compose exec postgres psql -U sales_user -d sales_dashboard` |
| App shell | `docker compose exec app sh` |
| Health check | `curl http://localhost:3000/api/health?db=true` |
| **Production** | |
| Start prod | `docker compose -f docker-compose.prod.yml up -d` |
| Stop prod | `docker compose -f docker-compose.prod.yml down` |
| Redeploy | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Prod logs | `docker compose -f docker-compose.prod.yml logs -f` |
| Backup DB | `docker compose -f docker-compose.prod.yml exec postgres pg_dump -U sales_user -d sales_dashboard > backup.sql` |
| Container stats | `docker stats` |
| Disk cleanup | `docker system prune -f && docker image prune -f` |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 5432 already in use | Stop Laragon PostgreSQL: Laragon UI → right-click PostgreSQL → Stop |
| Port 3000 already in use | Stop `npm run dev` (Ctrl+C) or kill the process |
| Container name conflict | `docker compose down --remove-orphans && docker container prune -f` |
| Docker daemon not running | Start Docker Desktop, wait for it to fully load |
| DB connection error in app | Verify `.env.docker` has `POSTGRES_HOST=postgres` (not `localhost`) |
| Init SQL didn't run | Init scripts only run on first start with empty volume. Reset: `docker compose down -v` |
| Container keeps restarting | Check logs: `docker compose logs app` — usually a missing env var |
| Out of disk space | Run `docker system prune -f` to clean unused images/containers |
| Build context too large | Verify `.dockerignore` exists and excludes `node_modules`, `.next`, `.git` |
| `npm ci` fails in build | Clear Docker build cache: `docker builder prune -f` then rebuild |
| Ghost containers after Docker Desktop restart | `docker compose down --remove-orphans && docker container prune -f && docker network prune -f` |
| Pages load slowly on first access | Normal — Turbopack compiles each page on first request (~5-15s) |
| Health check shows `database: error` | Check that `.env.docker` has correct `POSTGRES_URL` pointing to `postgres:5432` |
