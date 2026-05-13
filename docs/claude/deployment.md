# Deployment

Contabo-only. The Vercel + Neon deployment was retired 2026-05-13 (Vercel removal commit) — there is no longer a parallel target.

**Single target — Contabo self-hosted:** `http://157.173.110.62` on a Ubuntu 24.04 VPS, Docker-native, Postgres 17 in a sibling container. Deployed by `.github/workflows/deploy-contabo.yml` on every push to `main`: SSH → `git reset --hard` → `docker compose --env-file .env.production -f docker-compose.server.yml up -d --build` → healthcheck → done. See `docker/DEPLOY-CONTABO.md` for the runbook.

No local dev workflow — all changes must be production-ready.

**CI/CD key files:**
- `.github/workflows/deploy-contabo.yml` — auto-deploy pipeline (push to main)
- `docker-compose.server.yml` — lean HTTP-only compose used on Contabo (no nginx, no SSL)
- `docker-compose.prod.yml` — full nginx+certbot stack, intended for post-domain setup

**Contabo gotchas:**
- Compose variable substitution for postgres needs `--env-file .env.production` on every command
- `Dockerfile.prod` healthcheck uses `127.0.0.1` not `localhost` (BusyBox wget resolves localhost to IPv6 ::1 which Next.js standalone doesn't bind)
- `next.config.ts` has `typescript.ignoreBuildErrors: true` to work around pre-existing strict-mode errors in `src/lib/data.ts`
- File attachments are stored in a Docker named volume `uploads_data` mounted at `/var/lib/sales-dashboard/uploads` (env `UPLOADS_DIR`). The volume must exist on the host; first `up -d` creates it. Served back through the auth-protected `/api/files/[...path]` route — never publicly listed by the webserver.
- Legacy task-attachment rows from the Vercel Blob era still live in `file_attachments` with absolute Vercel CDN URLs in `url`. Those URLs are dead. New uploads use relative `/api/files/...` URLs and a populated `blob_path`. The DELETE handler no-ops on legacy rows (no file to unlink).

**Env-var contracts added in v3.3 (2026-05-13):**
- `RELEVANCY_MANUAL_EVAL_TOKEN` — Bearer token the dashboard sends to n8n's `job-evaluate-manual` webhook (`fvbhmg0NPnRm4z54`). Same value lives as an n8n `httpHeaderAuth` credential on J1. `/api/relevancy/evaluate-task` returns 500 if missing. The dashboard reads `process.env.RELEVANCY_MANUAL_EVAL_TOKEN` with `MANUAL_EVAL_TOKEN` accepted as a transitional alias (will be removed at next rotation).
- `RELEVANCY_INGEST_TOKEN` (pre-existing) — Bearer that n8n's classifier C10/C11 sends INTO `/api/relevancy-scores`. Two different tokens; never combine.
- Full env reference at `.env.relevancy.example`. Both `relevancy-evaluator` page and the `smoke-test-phase-14.ts` runner consume `RELEVANCY_MANUAL_EVAL_TOKEN` from env.
