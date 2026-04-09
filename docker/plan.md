# Dockerization & CI/CD Plan — Rising Lions Analytics Dashboard

> **Version:** 1.0  
> **Date:** 2026-04-09  
> **Stack:** Next.js 16 + PostgreSQL 16 + Nginx + GitHub Actions  
> **Environments:** Local Development | Production (Self-Hosted)

---

## Table of Contents

1. [Folder Structure](#1-folder-structure)
2. [Local Development Environment](#2-local-development-environment)
3. [Production Environment](#3-production-environment)
4. [Reverse Proxy & SSL](#4-reverse-proxy--ssl)
5. [CI/CD Pipeline](#5-cicd-pipeline)
6. [Server Setup & Requirements](#6-server-setup--requirements)
7. [Operational Runbook](#7-operational-runbook)
8. [Common Pitfalls](#8-common-pitfalls)

---

## 1. Folder Structure

```
sales-dashboard/
├── docker/
│   ├── plan.md                          # This file
│   ├── nginx/
│   │   ├── nginx.conf                   # Production Nginx config
│   │   ├── nginx.dev.conf               # Dev Nginx config (optional)
│   │   └── ssl/                         # SSL certs (mounted, not committed)
│   ├── postgres/
│   │   └── init/                        # SQL init scripts (mounted into PG)
│   └── scripts/
│       ├── healthcheck.sh               # App health check script
│       ├── wait-for-db.sh               # Wait for PG before starting app
│       └── backup-db.sh                 # Database backup script
├── Dockerfile.dev                       # Local development Dockerfile
├── Dockerfile.prod                      # Production multi-stage Dockerfile
├── docker-compose.yml                   # Local development compose
├── docker-compose.prod.yml              # Production compose
├── .dockerignore                        # Docker build context exclusions
├── .env.docker.example                  # Docker-specific env template
├── .github/
│   └── workflows/
│       └── deploy.yml                   # CI/CD pipeline
└── ...
```

### 1.1 File Purposes
- **`Dockerfile.dev`** — Hot-reload dev container, mounts source code as volume
- **`Dockerfile.prod`** — Multi-stage build: deps → build → minimal runtime image
- **`docker-compose.yml`** — Orchestrates app + postgres for local dev
- **`docker-compose.prod.yml`** — Orchestrates app + postgres + nginx for production
- **`.dockerignore`** — Keeps build context small (excludes node_modules, .next, .git)
- **`docker/nginx/`** — Nginx reverse proxy configs and SSL cert mount point
- **`docker/postgres/init/`** — Initialization SQL scripts run on first PG container start
- **`docker/scripts/`** — Operational scripts (health checks, DB waits, backups)

---

## 2. Local Development Environment

### 2.1 Dockerfile.dev
- **2.1.1 Base Image Selection**
  - Use `node:22-alpine` (LTS, small footprint, matches prod parity)
  - Alpine chosen for consistency with production; full `node:22` if native deps break
- **2.1.2 Working Directory**
  - Set `WORKDIR /app`
  - All subsequent commands run from `/app`
- **2.1.3 Dependency Installation**
  - Copy `package.json` + `package-lock.json` first (layer caching)
  - Run `npm ci` (deterministic, faster than `npm install`)
  - Separate from source code copy to cache deps layer
- **2.1.4 Source Code**
  - Do NOT copy source in Dockerfile — mount as volume in compose
  - Only copy package files for dependency installation
- **2.1.5 Port & Command**
  - Expose port 3000
  - Default command: `npm run dev`
  - Dev server watches for file changes via mounted volume

### 2.2 docker-compose.yml (Local Dev)
- **2.2.1 App Service (`app`)**
  - **2.2.1.1 Build Context**
    - Build from `Dockerfile.dev` at project root
    - Context is `.` (project root)
  - **2.2.1.2 Volume Mounts**
    - Mount `.:/app` for live source code sync (hot reload)
    - Mount `/app/node_modules` as anonymous volume (prevents host override)
    - Mount `/app/.next` as anonymous volume (build cache isolation)
  - **2.2.1.3 Environment Variables**
    - Load from `.env.local` (existing file)
    - Override `POSTGRES_HOST=postgres` (container hostname)
    - Override `POSTGRES_URL=postgresql://...@postgres:5432/...`
    - Set `WATCHPACK_POLLING=true` for Windows file watching
  - **2.2.1.4 Port Mapping**
    - Map `3000:3000` (Next.js dev server)
  - **2.2.1.5 Dependencies**
    - `depends_on: postgres` with health check condition
  - **2.2.1.6 Restart Policy**
    - `restart: unless-stopped`
    - Survives crashes but respects manual stops

- **2.2.2 PostgreSQL Service (`postgres`)**
  - **2.2.2.1 Image**
    - Use `postgres:16-alpine` (matches Neon's PG version)
  - **2.2.2.2 Environment**
    - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` from env file
  - **2.2.2.3 Volumes**
    - Named volume `pgdata:/var/lib/postgresql/data` for data persistence
    - Mount `docker/postgres/init/` to `/docker-entrypoint-initdb.d/` for auto-init
  - **2.2.2.4 Port Mapping**
    - Map `5432:5432` for direct access from host tools (pgAdmin, DBeaver)
  - **2.2.2.5 Health Check**
    - `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`
    - Interval: 5s, Timeout: 5s, Retries: 5
  - **2.2.2.6 Restart Policy**
    - `restart: unless-stopped`

- **2.2.3 Networking**
  - Default bridge network `sales-net` created by compose
  - App connects to PG via hostname `postgres` (service name)
  - No external network needed for local dev

- **2.2.4 Volumes Declaration**
  - `pgdata` — named volume, persists across container restarts
  - Survives `docker compose down` (only removed with `-v` flag)

### 2.3 Local Dev Workflow
- **2.3.1 First Run**
  - `cp .env.docker.example .env.local` (adjust values)
  - `docker compose up --build`
  - PG initializes with schema from `docker/postgres/init/`
  - App installs deps and starts dev server
  - Access at `http://localhost:3000`
- **2.3.2 Daily Development**
  - `docker compose up` (no rebuild needed unless deps change)
  - Edit files on host — changes reflect instantly via volume mount
  - Hot module replacement works through Next.js dev server
- **2.3.3 Dependency Changes**
  - After modifying `package.json`: `docker compose up --build`
  - Or: `docker compose exec app npm install`
- **2.3.4 Database Operations**
  - Connect from host: `psql -h localhost -U sales_user -d sales_dashboard`
  - Run migrations via browser: `http://localhost:3000/api/migrate?v=013&secret=...`
  - Reset DB: `docker compose down -v && docker compose up`
- **2.3.5 Troubleshooting**
  - View logs: `docker compose logs -f app`
  - Shell into app: `docker compose exec app sh`
  - Shell into PG: `docker compose exec postgres psql -U sales_user -d sales_dashboard`

---

## 3. Production Environment

### 3.1 Dockerfile.prod (Multi-Stage Build)
- **3.1.1 Stage 1: Dependencies (`deps`)**
  - **3.1.1.1 Base**: `node:22-alpine AS deps`
  - **3.1.1.2 Install**: Copy package files, run `npm ci --omit=dev`
  - **3.1.1.3 Purpose**: Isolated dependency layer; only production deps
  - **3.1.1.4 Optimization**: `npm cache clean --force` after install

- **3.1.2 Stage 2: Builder (`builder`)**
  - **3.1.2.1 Base**: `node:22-alpine AS builder`
  - **3.1.2.2 Copy**: All deps from stage 1 + full source code
  - **3.1.2.3 Build Args**:
    - All `NEXT_PUBLIC_*` vars needed at build time
    - `NEXT_TELEMETRY_DISABLED=1`
  - **3.1.2.4 Build**: Run `npm run build`
  - **3.1.2.5 Output**: Standalone Next.js output (`.next/standalone`)
    - Requires `output: "standalone"` in `next.config.ts`
    - Produces self-contained Node.js server (~50MB vs ~500MB full)
  - **3.1.2.6 Optimization**: Only `.next/standalone`, `.next/static`, and `public` carry forward

- **3.1.3 Stage 3: Runner (`runner`)**
  - **3.1.3.1 Base**: `node:22-alpine AS runner` (minimal runtime)
  - **3.1.3.2 Security**
    - Create non-root user: `addgroup -S nodejs && adduser -S nextjs -G nodejs`
    - Run as `nextjs` user (UID 1001)
    - No shell access for service user
  - **3.1.3.3 Copy Artifacts**
    - Copy `.next/standalone` from builder
    - Copy `.next/static` to `.next/standalone/.next/static`
    - Copy `public` to `.next/standalone/public`
    - Set ownership to `nextjs:nodejs`
  - **3.1.3.4 Runtime Config**
    - `ENV NODE_ENV=production`
    - `ENV PORT=3000`
    - `ENV HOSTNAME=0.0.0.0`
    - Expose port 3000
  - **3.1.3.5 Health Check**
    - `HEALTHCHECK CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1`
    - Interval: 30s, Timeout: 10s, Retries: 3, Start period: 40s
  - **3.1.3.6 Entrypoint**
    - `CMD ["node", "server.js"]` (standalone server)

- **3.1.4 Image Size Optimization**
  - **3.1.4.1** Alpine base: ~50MB vs ~350MB for Debian
  - **3.1.4.2** Multi-stage: final image has no build tools, no dev deps
  - **3.1.4.3** `.dockerignore` excludes .git, node_modules, docs, backups
  - **3.1.4.4** Standalone output: no node_modules in final image
  - **3.1.4.5** Target final image size: **~150MB** (vs ~1GB+ naive approach)

### 3.2 next.config.ts Changes Required
- **3.2.1** Add `output: "standalone"` to Next.js config
  - Enables standalone build mode for Docker
  - Bundles only used node_modules files into `.next/standalone`
  - Creates self-contained `server.js` entry point
- **3.2.2** No other changes needed — existing config is minimal

### 3.3 docker-compose.prod.yml
- **3.3.1 App Service (`app`)**
  - **3.3.1.1 Build**
    - Build from `Dockerfile.prod`
    - Or pull from container registry (GitHub Container Registry)
  - **3.3.1.2 Environment**
    - Load from `.env.production` file
    - `NODE_ENV=production`
    - `POSTGRES_HOST=postgres` (internal network)
    - All secrets via env file (never hardcoded)
  - **3.3.1.3 Restart Policy**
    - `restart: always` (auto-restart on crash or server reboot)
  - **3.3.1.4 Health Check**
    - Inherited from Dockerfile, also declarable in compose
  - **3.3.1.5 Logging**
    - JSON file driver with rotation:
      ```yaml
      logging:
        driver: json-file
        options:
          max-size: "10m"
          max-file: "3"
      ```
  - **3.3.1.6 Resource Limits**
    - Memory limit: 512MB (adjustable)
    - CPU limit: 1.0 (adjustable)
  - **3.3.1.7 Deploy (Swarm/Compose v2)**
    - Replicas: 1 (scale horizontally if needed)
    - Rolling update: 1 at a time, 10s delay

- **3.3.2 PostgreSQL Service (`postgres`)**
  - **3.3.2.1 Image**: `postgres:16-alpine`
  - **3.3.2.2 Environment**
    - Credentials from env file
    - `POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256` (secure auth)
  - **3.3.2.3 Volumes**
    - Named volume `pgdata_prod:/var/lib/postgresql/data`
    - Mount init scripts to `/docker-entrypoint-initdb.d/`
  - **3.3.2.4 No Port Exposure**
    - Do NOT map 5432 to host in production
    - Only accessible via internal Docker network
  - **3.3.2.5 Health Check**
    - Same as dev: `pg_isready`
  - **3.3.2.6 Restart Policy**: `restart: always`
  - **3.3.2.7 Logging**: JSON file with rotation
  - **3.3.2.8 Security**
    - No `POSTGRES_HOST_AUTH_METHOD=trust` (use password auth)
    - Strong password required
    - Internal network only

- **3.3.3 Nginx Service (`nginx`)**
  - **3.3.3.1 Image**: `nginx:alpine`
  - **3.3.3.2 Port Mapping**
    - `80:80` (HTTP → redirect to HTTPS)
    - `443:443` (HTTPS → proxy to app:3000)
  - **3.3.3.3 Volumes**
    - Mount `docker/nginx/nginx.conf` to `/etc/nginx/nginx.conf`
    - Mount SSL certs directory to `/etc/nginx/ssl`
    - Mount Certbot webroot for ACME challenges
  - **3.3.3.4 Dependencies**: `depends_on: app`
  - **3.3.3.5 Restart Policy**: `restart: always`
  - **3.3.3.6 Logging**: JSON file with rotation

- **3.3.4 Certbot Service (`certbot`)** — optional, for Let's Encrypt
  - **3.3.4.1 Image**: `certbot/certbot`
  - **3.3.4.2 Volumes**: Share webroot + certs with nginx
  - **3.3.4.3 Command**: Certificate renewal
  - **3.3.4.4 Entrypoint**: Renewal loop (every 12h)

- **3.3.5 Networking**
  - Internal network `prod-net` (bridge)
  - Only nginx exposes ports to host
  - App and PG communicate on internal network only

- **3.3.6 Volumes Declaration**
  - `pgdata_prod` — PostgreSQL data persistence
  - `certbot-etc` — Let's Encrypt certificates
  - `certbot-var` — Certbot state

### 3.4 Health Check Endpoint
- **3.4.1** Create `src/app/api/health/route.ts`
  - Returns `200 OK` with JSON `{ status: "ok", timestamp, uptime }`
  - Optionally checks DB connectivity
  - Used by Docker HEALTHCHECK, Nginx upstream checks, monitoring
- **3.4.2** No auth required (public endpoint)
- **3.4.3** Lightweight — no DB query by default (add `?db=true` for deep check)

---

## 4. Reverse Proxy & SSL

### 4.1 Nginx Configuration
- **4.1.1 HTTP Block**
  - **4.1.1.1** Worker processes: auto (matches CPU cores)
  - **4.1.1.2** Worker connections: 1024
  - **4.1.1.3** Gzip compression enabled for text/html, CSS, JS, JSON
  - **4.1.1.4** Client max body size: 10MB
  - **4.1.1.5** Proxy headers: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto

- **4.1.2 Upstream Block**
  - Define `upstream nextjs { server app:3000; }`
  - Enables future load balancing across multiple app containers

- **4.1.3 HTTP Server Block (Port 80)**
  - **4.1.3.1** Listen on 80
  - **4.1.3.2** ACME challenge location: `/.well-known/acme-challenge/`
  - **4.1.3.3** All other traffic: 301 redirect to HTTPS

- **4.1.4 HTTPS Server Block (Port 443)**
  - **4.1.4.1** SSL certificate + key paths (from certbot or manual)
  - **4.1.4.2** SSL protocols: TLSv1.2, TLSv1.3 only
  - **4.1.4.3** SSL ciphers: modern, secure suite
  - **4.1.4.4** HSTS header: `max-age=31536000; includeSubDomains`
  - **4.1.4.5** Proxy pass to `http://nextjs`
  - **4.1.4.6** WebSocket support headers (Connection: Upgrade)
  - **4.1.4.7** Static file caching: `/_next/static/` → 1 year, immutable
  - **4.1.4.8** Security headers: X-Frame-Options, X-Content-Type-Options, etc.

### 4.2 SSL Certificate Setup
- **4.2.1 Initial Certificate (Let's Encrypt)**
  - Start nginx with HTTP-only config first
  - Run certbot: `certbot certonly --webroot -w /var/www/certbot -d yourdomain.com`
  - Switch to full nginx config with SSL
  - Restart nginx
- **4.2.2 Auto-Renewal**
  - Certbot container runs renewal check every 12 hours
  - Nginx reloads certs on SIGHUP (no downtime)
  - Cron or certbot `--deploy-hook "nginx -s reload"`
- **4.2.3 Self-Signed (Alternative for Internal/Testing)**
  - Generate with `openssl req -x509 -nodes -days 365 ...`
  - Mount to same SSL paths in nginx config

---

## 5. CI/CD Pipeline

### 5.1 Deployment Architecture Options

- **5.1.1 Option A: SSH-Based Deployment (RECOMMENDED)**
  - **5.1.1.1 How It Works**
    - GitHub Actions runner SSH into server
    - Pull latest code, rebuild containers, restart
    - Simple, no extra infrastructure
  - **5.1.1.2 Pros**
    - No software to install on server (just SSH + Docker)
    - GitHub-hosted runners = free for public repos, included minutes for private
    - Easy to debug (just SSH commands)
  - **5.1.1.3 Cons**
    - SSH key management required
    - Slower than local runner (network transfer)
  - **5.1.1.4 Recommendation**: Best for small-medium teams, single server

- **5.1.2 Option B: Self-Hosted GitHub Runner**
  - **5.1.2.1 How It Works**
    - Install GitHub Actions runner on server
    - Builds happen locally on server (fast)
    - No SSH needed
  - **5.1.2.2 Pros**
    - Faster builds (no network transfer)
    - No SSH key exposure
    - Access to local resources
  - **5.1.2.3 Cons**
    - Runner software to maintain
    - Security risk: runner has server access
    - Must keep runner updated
  - **5.1.2.4 When to use**: Large projects, multiple servers, or org-level runners

- **5.1.3 Chosen Approach: SSH-Based (Option A)**
  - Simpler setup, fewer moving parts
  - Adequate for single-server deployment
  - Self-hosted runner can be added later if needed

### 5.2 GitHub Actions Workflow

- **5.2.1 Trigger Conditions**
  - **5.2.1.1** Push to `main` branch → Deploy to **production server**
  - **5.2.1.2** Push to `staging` branch → Deploy to **staging/local server**
  - **5.2.1.3** Pull request to `main` → Build check only (no deploy)
  - **5.2.1.4** Manual dispatch (`workflow_dispatch`) → Choose environment

- **5.2.2 Job: Build & Test**
  - **5.2.2.1** Checkout code
  - **5.2.2.2** Setup Node.js 22
  - **5.2.2.3** Install dependencies (`npm ci`)
  - **5.2.2.4** Run linter (`npm run lint`)
  - **5.2.2.5** Run type check (`npx tsc --noEmit`)
  - **5.2.2.6** Build Next.js (`npm run build`) — catches build errors
  - **5.2.2.7** Fail fast — don't deploy if any step fails

- **5.2.3 Job: Build Docker Image**
  - **5.2.3.1** Build production Docker image
  - **5.2.3.2** Tag with git SHA + `latest`
  - **5.2.3.3** Push to GitHub Container Registry (`ghcr.io`)
  - **5.2.3.4** Cache Docker layers for faster builds

- **5.2.4 Job: Deploy**
  - **5.2.4.1 SSH Connection**
    - Use `appleboy/ssh-action` for SSH commands
    - SSH key stored in GitHub Secrets
    - Strict host key checking enabled
  - **5.2.4.2 Deployment Steps**
    - SSH into server
    - `cd /opt/sales-dashboard`
    - `git pull origin main` (or staging)
    - Copy env file if changed
    - `docker compose -f docker-compose.prod.yml pull` (if using registry)
    - OR `docker compose -f docker-compose.prod.yml build --no-cache`
    - `docker compose -f docker-compose.prod.yml up -d`
    - Run health check: `curl -f http://localhost:3000/api/health`
    - Clean old images: `docker image prune -f`
  - **5.2.4.3 Post-Deploy**
    - Notify on success (Slack webhook, optional)
    - Notify on failure with error details

### 5.3 GitHub Secrets Required
```
SSH_HOST          — Server IP or hostname
SSH_USER          — SSH username
SSH_PRIVATE_KEY   — SSH private key (ed25519 recommended)
SSH_PORT          — SSH port (default: 22)
GHCR_TOKEN        — GitHub token for container registry (or use GITHUB_TOKEN)
DEPLOY_PATH       — Path on server (e.g., /opt/sales-dashboard)
PROD_ENV_FILE     — Base64-encoded .env.production contents
SLACK_WEBHOOK     — (Optional) Slack notification URL
```

### 5.4 Zero-Downtime Deployment
- **5.4.1 Strategy: Rolling Restart**
  - Docker Compose `up -d` recreates only changed services
  - PG container unchanged → no restart → no data loss
  - App container rebuilt → brief gap (5-10s)
- **5.4.2 Enhanced: Blue-Green (Future)**
  - Run new container alongside old
  - Switch nginx upstream after health check passes
  - Stop old container
  - Requires custom deploy script
- **5.4.3 Current Approach**
  - Accept 5-10s downtime on deploy (acceptable for internal dashboard)
  - Health check verifies new container is up before declaring success

### 5.5 Rollback Strategy
- **5.5.1 Quick Rollback (Git-based)**
  - `git revert HEAD && git push` → triggers redeploy of previous state
  - Or: `git reset --hard HEAD~1 && git push --force` (destructive)
- **5.5.2 Container Rollback (Image-based)**
  - Previous images tagged with git SHA in GHCR
  - SSH into server: `docker compose -f docker-compose.prod.yml down`
  - Update image tag in compose file to previous SHA
  - `docker compose -f docker-compose.prod.yml up -d`
- **5.5.3 Database Rollback**
  - Migrations are forward-only (no automatic rollback)
  - Keep database backups before deploying migration changes
  - Manual SQL rollback if needed
- **5.5.4 Automated Rollback (in CI/CD)**
  - Health check fails after deploy → auto-revert to previous image
  - Implemented in deploy.yml with failure handling

---

## 6. Server Setup & Requirements

### 6.1 Minimum Server Requirements
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS |
| Network | Public IP + domain | + Firewall (UFW) |

### 6.2 Required Software
```bash
# Docker Engine (not Docker Desktop)
curl -fsSL https://get.docker.com | sh

# Docker Compose v2 (included with Docker Engine)
docker compose version

# Git
sudo apt install git -y
```

### 6.3 Firewall Configuration
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```
- Do NOT open 3000 (app) or 5432 (postgres) to public
- Only nginx (80/443) should be publicly accessible

### 6.4 Server Initialization Steps
```bash
# 1. Clone repository
sudo mkdir -p /opt/sales-dashboard
sudo chown $USER:$USER /opt/sales-dashboard
git clone https://github.com/YOUR_ORG/sales-dashboard.git /opt/sales-dashboard
cd /opt/sales-dashboard

# 2. Create environment file
cp .env.docker.example .env.production
nano .env.production  # Fill in all values

# 3. Create SSL certificates (first time)
# Option A: Let's Encrypt
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d yourdomain.com --email admin@yourdomain.com --agree-tos

# Option B: Self-signed (for testing)
mkdir -p docker/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/nginx/ssl/privkey.pem \
  -out docker/nginx/ssl/fullchain.pem \
  -subj "/CN=yourdomain.com"

# 4. Start all services
docker compose -f docker-compose.prod.yml up -d

# 5. Run database migrations
curl -f "http://localhost:3000/api/migrate?v=013&secret=YOUR_CRON_SECRET"

# 6. Verify
docker compose -f docker-compose.prod.yml ps
curl -f http://localhost:3000/api/health
```

---

## 7. Operational Runbook

### 7.1 Database Backups
- **7.1.1 Manual Backup**
  ```bash
  docker compose -f docker-compose.prod.yml exec postgres \
    pg_dump -U sales_user -d sales_dashboard > backup_$(date +%Y%m%d_%H%M%S).sql
  ```
- **7.1.2 Automated Backup**
  - Add cron on host: `0 2 * * * /opt/sales-dashboard/docker/scripts/backup-db.sh`
  - Keeps last 7 daily backups
  - Optional: upload to S3/B2 for offsite storage
- **7.1.3 Restore**
  ```bash
  docker compose -f docker-compose.prod.yml exec -i postgres \
    psql -U sales_user -d sales_dashboard < backup_file.sql
  ```

### 7.2 Monitoring & Logs
- **7.2.1 View Logs**
  ```bash
  docker compose -f docker-compose.prod.yml logs -f app       # App logs
  docker compose -f docker-compose.prod.yml logs -f postgres   # DB logs
  docker compose -f docker-compose.prod.yml logs -f nginx      # Proxy logs
  ```
- **7.2.2 Container Status**
  ```bash
  docker compose -f docker-compose.prod.yml ps
  docker stats  # Live resource usage
  ```
- **7.2.3 Disk Usage**
  ```bash
  docker system df           # Docker disk usage
  docker image prune -f      # Remove unused images
  docker volume ls            # List volumes
  ```

### 7.3 Scaling (Future)
- Add replicas: `docker compose -f docker-compose.prod.yml up -d --scale app=3`
- Nginx upstream auto-discovers scaled containers
- PostgreSQL stays single instance (use managed DB for HA)

---

## 8. Common Pitfalls

### 8.1 Docker Pitfalls
| Pitfall | Solution |
|---------|----------|
| `node_modules` from host overrides container | Anonymous volume mount: `/app/node_modules` |
| File watching doesn't work on Windows | Set `WATCHPACK_POLLING=true` in compose env |
| Large Docker build context | `.dockerignore` excludes .git, node_modules, .next |
| PG data lost on `docker compose down -v` | Never use `-v` flag unless intentional reset |
| Container can't resolve `postgres` hostname | Ensure both services on same Docker network |
| Permission errors in container | Match UID/GID or use `chown` in Dockerfile |
| `.env` file not loaded | Use `env_file` in compose, not `environment` for files |

### 8.2 Next.js + Docker Pitfalls
| Pitfall | Solution |
|---------|----------|
| Build fails: missing env vars | Use `ARG` in Dockerfile for build-time `NEXT_PUBLIC_*` vars |
| Standalone output missing static files | Copy `.next/static` and `public` separately |
| `@vercel/postgres` fails locally | `db.ts` abstraction detects localhost → uses `pg` Pool |
| Port not accessible outside container | Set `HOSTNAME=0.0.0.0` (not localhost) |
| next.config.ts missing `output: "standalone"` | Required for Docker production builds |

### 8.3 CI/CD Pitfalls
| Pitfall | Solution |
|---------|----------|
| SSH key permission denied | Key must be ed25519/RSA, correct permissions (600) |
| Docker build fails on CI but works locally | `.dockerignore` differences, env vars missing |
| Deploy succeeds but app broken | Health check + auto-rollback in pipeline |
| Secrets exposed in logs | Use GitHub Secrets, never echo sensitive values |
| Concurrent deploys conflict | GitHub concurrency groups: cancel in-progress |

### 8.4 PostgreSQL Pitfalls
| Pitfall | Solution |
|---------|----------|
| Init scripts don't run | Only run on FIRST container start (empty volume) |
| Data persists after schema change | Drop volume or run migration, don't rely on init |
| Connection refused on startup | `wait-for-db.sh` or `depends_on` with healthcheck |
| Encoding issues | Set `POSTGRES_INITDB_ARGS=--encoding=UTF8` |
