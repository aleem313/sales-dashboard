# Phase 11 — Smoke Test Run Log

| Run | Outcome | Notes |
|---|---|---|
| `2026-05-13T15-56-41-585Z.{json,md}` | ⚠️ INVALID — false 90% PASS | Pre-fix run. J3 was returning the `/login` HTML for every fixture because `/api/tasks/:path*` was in the NextAuth middleware matcher. The classifier correctly identified the input as garbage and rejected — by coincidence matching the 18 fixtures that expected reject. **Do not use for calibration.** Kept as historical evidence of the middleware bug (fixed in `9d8c3eb`). |
| `2026-05-13T16-03-57-117Z.{json,md}` | ✅ 18/20 (90%) PASS — but shallow signal | First clean run. All 20 fixtures took the **deterministic** path (`evaluation_path = deterministic`, gate 2 freshness reject) because the fixtures were captured 2026-05-11 and the smoke test ran 2026-05-13 — every job is now ≥9 days old → gate 2 fires before C5 (Gemini) is reached. **LLM-evaluated gates (1, 7, 8, 9, 10, 11), rubric scoring, and threshold flipping were not exercised.** |

## What the clean run validated

- ✅ End-to-end plumbing: dashboard → n8n J1 → J3 (`GET /api/tasks/:id/job-payload`, returns real task data) → J4 → J5 → classifier core sub-workflow → audit-log POST → J6 → J7 → response
- ✅ Gate 2 (freshness) — 20/20 fixtures correctly identified as stale
- ✅ `task_id` linkage on every `relevancy_scores` row (verified via Postgres)
- ✅ `evaluation_path` correctly set to `deterministic`
- ✅ `source = manual_url` on every row
- ✅ Latency: 0.7–3.5s per fixture (deterministic short-circuit avoids Gemini)

## What the clean run did NOT validate

- ❌ LLM-evaluated gates: stack match (gate 1), job availability (gate 7), location lock-in (gate 8), video proposal (gate 9), portfolio match (gate 10), duplicate check (gate 11)
- ❌ 7-component rubric scoring
- ❌ Threshold flipping (raw proceed → effective reject when score < min_score)
- ❌ Soft signals (non-English description on fixture #5, etc.)
- ❌ Candidate-false-reject calibration (#17, #18) — these were rejected via gate 2 freshness, so we can't tell whether the LLM would have flagged them as PROCEED with fresh data

## Implication for Phase 14 (Active rollout)

The smoke test PASSES the Appendix D.4 threshold (≥85%), so the pipeline is structurally ready for Phase 14 — but the **LLM calibration signal** has to come from elsewhere:

1. **Live shadow data** — the classifier has been in Shadow mode on the auto pipeline since 2026-05-12. Each new Vollna-fed job runs through the same classifier sub-workflow with fresh data (posted within 24h, so gate 2 doesn't fire) and writes to `relevancy_scores`. By the time Phase 13 (calibration review) opens, there should be ≥7 days of shadow data with `evaluation_path = llm_after_deterministic` — that's the data set to calibrate `min_score` against, NOT this smoke test.

2. **Audit page** (`/relevancy-audit`) — surfaces the rejects from shadow data. Admin can flag false rejects, which writes `relevancy_overrides` rows. After ~50 overrides accumulate, that's a real human-ground-truth signal.

## Future Phase 11 refresh

If a refresh of the fixture catalog is needed (Phase 17 post-launch review or earlier), the catalog must be **rebuilt from jobs posted within 24h of the run time** so gate 2 doesn't short-circuit. The captured-reasons ground truth then has to come from the agent who triages each card in real time. See `docs/upwork-relevancy-scoring-ai-plan-v3.md` §Appendix D.5.

Alternative for an LLM-focused smoke test: keep this fixture set but stamp `request_meta.bypass_freshness = true` in J4 and add a corresponding check in C2 to skip gate 2 when the flag is set. That's classifier-keeper territory; not done for v3.3.
