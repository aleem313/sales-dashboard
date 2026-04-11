# Contabo HTTP-only deployment

Lean deployment recipe for a fresh Contabo VPS at a plain IP, before a
domain + Let's Encrypt are in place.

- **Target**: `http://157.173.110.62/api/webhook/n8n`
- **Compose file**: `docker-compose.server.yml`
- **App**: published on host port 80 (no nginx, no certbot)
- **DB**: Postgres 17 inside the compose network, not exposed publicly

Upgrade path: once you have a domain, switch to `docker-compose.prod.yml`
(which adds nginx + certbot) without rebuilding the app image.

---

## 1. One-time server prep (on Contabo)

```bash
# Docker + compose plugin
apt update && apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Firewall — allow SSH + HTTP
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable

# App dir
mkdir -p /opt/sales-dashboard
```

## 2. Get the code onto the server

Option G1 — git clone (preferred):

```bash
cd /opt/sales-dashboard
git clone https://github.com/<you>/<repo>.git .
git checkout feature/n8n-parallel-dashboard-sink   # or main, after merge
```

Option G2 — rsync from your Windows laptop (if repo is local-only):

```powershell
# From your local project root
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  ./ root@157.173.110.62:/opt/sales-dashboard/
```

## 3. Create `.env.production`

```bash
cd /opt/sales-dashboard
cp .env.server.example .env.production
nano .env.production   # fill in all CHANGE_ME_* values
```

Generate secrets quickly:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # N8N_WEBHOOK_SECRET
openssl rand -hex 32      # CRON_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
```

Make sure `POSTGRES_PASSWORD` appears in both the `POSTGRES_PASSWORD=` line
and inside the two `POSTGRES_URL*` connection strings.

## 4. Build and start

```bash
docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml logs -f app
```

First build takes 2–4 minutes. App listens on host port 80.

## 5. Run migrations

Once the app is healthy, hit the migrate endpoint in a browser (or curl) — the
URL/secret are from your `.env.production`:

```
http://157.173.110.62/api/migrate?v=006&secret=<CRON_SECRET>
http://157.173.110.62/api/migrate?v=007&secret=<CRON_SECRET>
...
http://157.173.110.62/api/migrate?v=013&secret=<CRON_SECRET>
```

All migrations are idempotent, so running 006 → 013 in order on a fresh DB
produces the same schema as the current Vercel/Neon deployment.

## 6. Verify

```bash
curl -s http://157.173.110.62/api/health
# → { "status": "ok", ... }

# Simulate an n8n webhook
curl -X POST http://157.173.110.62/api/webhook/n8n \
  -H "content-type: application/json" \
  -d '{"event":"job_processed","outcome":"gpt_error","job":{"id":"TEST-1","title":"smoke test"},"routing":{},"client":{},"scores":{}}'
# → { "ok": true, ... }
```

## 7. Point the n8n parallel node

After deploy succeeds, the `Send to Self-Hosted Dashboard` node in n8n
workflow `EWnZg3svZWwcIRs4` starts delivering the same payloads it sends
to the Vercel node. Because the node uses `neverError: true`, it was safe
to add before the server existed — it simply no-op'd until now.

## 8. Operational notes

- **Logs**: `docker compose -f docker-compose.server.yml logs -f app`
- **DB shell**: `docker compose -f docker-compose.server.yml exec postgres psql -U sales_user sales_dashboard`
- **Update**: `git pull && docker compose -f docker-compose.server.yml up -d --build`
- **Backup DB**: `docker compose -f docker-compose.server.yml exec postgres pg_dump -U sales_user sales_dashboard | gzip > backup-$(date +%F).sql.gz`
