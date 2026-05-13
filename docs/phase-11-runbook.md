# Phase 11 — Smoke Test Runbook

Replays 20 frozen Appendix D fixtures through the manual evaluator's classifier path and reports decision/reason agreement. Gate for Phase 12 (shadow rollout) entry.

## Prerequisites

| Item | Where | Notes |
|---|---|---|
| `RELEVANCY_MANUAL_EVAL_TOKEN` | Bearer token attached to n8n J1 Webhook credential | The same value the dashboard uses to call `/webhook/job-evaluate-manual`. (`MANUAL_EVAL_TOKEN` is accepted as a legacy alias.) |
| `job-evaluate-manual` workflow active | n8n cloud (`fvbhmg0NPnRm4z54`) | Credential attached to J1, workflow toggled ON |
| `_relevancy-classifier-core` active | n8n cloud (`hi71jhPU8tmq7hEp`) | Already active since 2026-05-12 |
| Snapshots loaded | Shayan, Saim, Craig, Khansa, Sana | Per Appendix D.6 — all already loaded |
| Test cards present | 20 task UUIDs in `tasks` table | Appendix D.2 — captured 2026-05-11, still in Postgres |

## How to run

From repo root, with `RELEVANCY_MANUAL_EVAL_TOKEN` exported:

```bash
export RELEVANCY_MANUAL_EVAL_TOKEN=<your-token>
npx tsx scripts/smoke-test-phase-11.ts
```

Optional flags:

| Flag | Default | Purpose |
|---|---|---|
| `--only 1,12,17` | all 20 | Run a subset (debug specific fixtures) |
| `--concurrency 2` | `1` | Increase parallelism — keep low to avoid Gemini rate-limit |
| `--webhook-base <url>` | `https://ikonicdev.app.n8n.cloud/webhook` | Override n8n cloud URL |
| `--token <value>` | `$RELEVANCY_MANUAL_EVAL_TOKEN` | Inline token (avoid for shell history) |

PowerShell:

```powershell
$env:RELEVANCY_MANUAL_EVAL_TOKEN = "<token>"
npx tsx scripts/smoke-test-phase-11.ts
```

## What it does

1. Reads `docs/phase-11-fixtures.json`.
2. For each fixture, POSTs `{task_id, profile_id, requested_by:"smoke-test-phase-11", request_id:<uuid>}` to `/webhook/job-evaluate-manual` with Bearer auth.
3. Captures verdict (decision, gates_failed, rejection_reasons, total_score, confidence, latency).
4. Scores each fixture:
   - **Decision match**: `effective_decision` equals `expected_decision` → 1 point
   - **Borderline cases** (#10, #19, #20): full credit on match, half credit on `review`, zero on opposite decision
   - **Reason overlap**: only computed for `single_reason` + `multi_reason` fixtures; checks if expected gate id is in `gates_failed` OR expected reason label is in `rejection_reasons` (case-insensitive)
5. Writes two files under `docs/phase-11-results/<ISO-timestamp>.{json,md}`.
6. Prints the markdown summary to stdout.

## How to read the results

Look at the **Verdict** line of the summary table:

| Outcome | Meaning | Action |
|---|---|---|
| ✅ **PASS** (≥ 17/20) | Classifier is calibrated; agents and AI agree on what to reject | Proceed to Phase 12 (shadow rollout) |
| ⚠️ **MARGINAL** (14–16/20) | Close but not there | Open `/settings` → bump global `min_score` (try 50 → 60), wait for cache invalidation, re-run smoke test |
| ❌ **FAIL** (< 14/20) | Prompt is mis-aligned with the criteria | Don't ship. Audit failing fixtures section, update PRD §16 example library + Mode A prompt, redeploy classifier, re-run |

Then inspect **Failures (detail)** — each entry shows expected vs. got plus the classifier's own `summary` text. That tells you *why* the LLM made the call it did, which is the most useful signal for tuning.

## Calibration loop (Appendix D.4)

```
run smoke test  →  ≥85%?  →  YES  →  Phase 12 shadow rollout
                      │
                      NO (70–85%)
                      │
                      ▼
              bump min_score via /settings (50 → 60 → 70 …)
                      │
                      ▼
                re-run smoke test
                      │
                      NO (< 70%)
                      │
                      ▼
        re-audit Mode A prompt + PRD §16 examples
        n8n-relevancy-classifier-keeper agent handles
                      │
                      ▼
                re-run smoke test
```

## Files involved

| File | What |
|---|---|
| `docs/phase-11-fixtures.json` | Frozen Appendix D.2 catalog (20 fixtures) |
| `scripts/smoke-test-phase-11.ts` | The runner |
| `docs/phase-11-results/<ts>.json` | Per-run full verdict dump (machine-readable) |
| `docs/phase-11-results/<ts>.md` | Per-run human summary (commit one for the calibration record) |
| `docs/upwork-relevancy-scoring-ai-plan-v3.md` §Appendix D | Source spec — fixture rationale + pass criterion |

## Notes

- The runner **bypasses** `/api/relevancy/evaluate-task` (the dashboard route) and posts directly to n8n. That's intentional: the route adds NextAuth + rate-limiting + persistence, none of which affect what the classifier says. The classifier path (J1 → J3 → J4 → J5 → classifier core → J6 → J7) is identical.
- Cards #17 + #18 are the strongest "false reject" candidates. If they come back as `proceed`, that's the headline calibration win — it means the classifier disagrees with an agent oversight (no `_reason` was tagged when the card was moved to N/A).
- Latency: expect 1.5–3s per fixture warm path. Total run with `--concurrency 1` ≈ 30–60s; with `--concurrency 2` ≈ 15–30s. Don't go higher than 2 — Gemini's per-minute quota is the bottleneck (see CLAUDE.md notes on retry config).
- The fixture file is **frozen** for v3.3. Don't edit it during the calibration loop — change prompts and thresholds instead. Phase 17 (post-launch review) decides whether to refresh for v3.4.
