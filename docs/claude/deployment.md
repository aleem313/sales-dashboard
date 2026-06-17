# Deployment

Contabo-only. The Vercel + Neon deployment was retired 2026-05-13 (Vercel removal commit) — there is no longer a parallel target.

**Single target — Contabo self-hosted:** `https://risinglions.ikonicsolution.com` (→ 157.173.110.62) on a Ubuntu 24.04 VPS, Docker-native, Postgres 17 in a sibling container. Deployed by `.github/workflows/deploy-contabo.yml` on every push to `main`: SSH → `git reset --hard` → `docker compose --env-file .env.production -f docker-compose.server.yml up -d --build` → healthcheck (`curl -skf https://localhost/api/health`, through nginx TLS) → done. See `docker/DEPLOY-CONTABO.md` for the runbook.

**HTTPS went live 2026-06-17.** `docker-compose.server.yml` is now the **nginx+certbot HTTPS stack** (not HTTP-only anymore): nginx terminates TLS on 80/443, redirects 80→443, proxies to the app (which no longer publishes a host port). Cert for `risinglions.ikonicsolution.com` issued via certbot **standalone** (one-off, host `/etc/letsencrypt`), renewal switched to **webroot** (`certbot` container, shared `certbot-webroot` volume, dry-run verified). nginx mounts the host `/etc/letsencrypt` read-only. `docker/nginx/nginx.conf` has the real cert path + a dedicated `/api/events/` `proxy_buffering off` block for the SSE stream. Server-side, non-repo state: `ufw allow 443/tcp`; `.env.production` set `AUTH_URL=https://risinglions.ikonicsolution.com` + `AUTH_TRUST_HOST=true` (NextAuth v5 must trust the proxy host or logins/CSRF break). **This unlocked browser desktop notifications** for the agent task bell — the `Notification` API needs a secure context, now satisfied.

> **⚠️ DO NOT switch the deploy to `docker-compose.prod.yml`.** It mounts a *different* postgres volume (`pgdata_prod` vs the live `pgdata_server`) and has no `uploads_data` mount — bringing it up would start an **empty DB** and lose attachments. The HTTPS stack was added *into* `server.yml` precisely to keep the live volumes. `prod.yml` is effectively dead; treat `server.yml` as the only target.

No local dev workflow — all changes must be production-ready.

**CI/CD key files:**
- `.github/workflows/deploy-contabo.yml` — auto-deploy pipeline (push to main)
- `.github/workflows/relevancy-dlq-drain.yml` — hourly cron at `:07` that POSTs `/api/cron/relevancy-dlq-drain` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Concurrency-locked (`cancel-in-progress: true`) so manual dispatch + cron never overlap. Captures HTTP status + body via `-w` and `-o` so 5xx error bodies surface in the run summary — do NOT use `curl -sSf`, that swallows the body. Repo secret `CRON_SECRET` value must be the bare token (no `Bearer ` prefix); the workflow adds the prefix. Telemetry: GitHub masks the secret as `***`, so a healthy log reads `Authorization: Bearer ***`. If you see `Authorization: ***` (no visible `Bearer`), the secret value contains the prefix — strip it.
- `docker-compose.server.yml` — **the live stack**: app + postgres (`pgdata_server`) + uploads (`uploads_data`) + **nginx + certbot HTTPS** (since 2026-06-17). This is what the deploy pipeline brings up.
- `docker-compose.prod.yml` — **dead / do not use.** Was the original "post-domain" stack but uses `pgdata_prod` (≠ live `pgdata_server`) and no uploads mount, so switching to it would wipe the DB + attachments. HTTPS was instead folded into `server.yml`. `docker/nginx/nginx.conf` has a dedicated `/api/events/` location with `proxy_buffering off` so the SSE stream isn't stalled by nginx buffering — keep it when editing the proxy.

**Contabo gotchas:**
- `nginx.conf` is a **single-file bind mount** — editing it + `git reset --hard` gives the host file a new inode, but `docker compose up -d` won't recreate the nginx container (mount path unchanged), so it serves the **stale inode**. The deploy workflow runs `$COMPOSE up -d --force-recreate nginx` after the build to force a re-bind. If you ever edit nginx.conf out-of-band, `docker compose ... up -d --force-recreate nginx` (a plain reload is NOT enough — reload re-reads the same stale inode).
- Compose variable substitution for postgres needs `--env-file .env.production` on every command
- `Dockerfile.prod` healthcheck uses `127.0.0.1` not `localhost` (BusyBox wget resolves localhost to IPv6 ::1 which Next.js standalone doesn't bind)
- `next.config.ts` has `typescript.ignoreBuildErrors: true` to work around pre-existing strict-mode errors in `src/lib/data.ts`
- File attachments are stored in a Docker named volume `uploads_data` mounted at `/var/lib/sales-dashboard/uploads` (env `UPLOADS_DIR`). The volume must exist on the host; first `up -d` creates it. Served back through the auth-protected `/api/files/[...path]` route — never publicly listed by the webserver.
- Legacy task-attachment rows from the Vercel Blob era still live in `file_attachments` with absolute Vercel CDN URLs in `url`. Those URLs are dead. New uploads use relative `/api/files/...` URLs and a populated `blob_path`. The DELETE handler no-ops on legacy rows (no file to unlink).

**Env-var contracts added in v3.3 (2026-05-13):**
- `RELEVANCY_MANUAL_EVAL_TOKEN` — Bearer token the dashboard sends to n8n's `job-evaluate-manual` webhook (`fvbhmg0NPnRm4z54`). Same value lives as an n8n `httpHeaderAuth` credential on J1. `/api/relevancy/evaluate-task` returns 500 if missing. The dashboard reads `process.env.RELEVANCY_MANUAL_EVAL_TOKEN` with `MANUAL_EVAL_TOKEN` accepted as a transitional alias (will be removed at next rotation).
- `RELEVANCY_INGEST_TOKEN` (pre-existing) — Bearer that n8n's classifier C10/C11 sends INTO `/api/relevancy-scores`. Two different tokens; never combine.
- Full env reference at `.env.relevancy.example`. Both `relevancy-evaluator` page and the `smoke-test-phase-14.ts` runner consume `RELEVANCY_MANUAL_EVAL_TOKEN` from env.
