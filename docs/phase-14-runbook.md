# Phase 13 + 14 — Active Rollout Runbook

The "I want to flip the relevancy classifier to Active" operator playbook. No further development work is needed; every step is something you do in the dashboard UI (or via a one-line CLI check).

## Pre-flight checklist (Phase 13 — calibration review)

Run after ~7 days of shadow data has accumulated.

1. **Sanity check the system end-to-end**

   ```powershell
   $env:RELEVANCY_MANUAL_EVAL_TOKEN = "<your-token>"
   npx tsx scripts/smoke-test-phase-14.ts
   ```

   Expects 4/4 checks pass:
   - Profile context endpoint reachable
   - `_system.classifier_mode` populated
   - `_system.effective_min_score` populated
   - Manual evaluator webhook smoke (one real classifier call)

   If any fail, fix the underlying issue first.

2. **Open the audit page**: `/relevancy-audit`

   Scan classifier rejects from the last 7 days. Look for *false rejects* —
   verdicts where the classifier said `reject` but the card actually got
   processed (proposal sent, won, in progress). Use the override panel to flag
   them; that signal feeds Phase 17 review.

3. **Open Settings → Relevancy Classifier**

   The **Threshold preview** block under the min_score input shows:

   - Total scored verdicts in the last 7 days
   - Decision split (proceeds / rejects / reviews)
   - For each candidate min_score (40, 50, 60, 70, 80): how many *current
     proceeds* would flip to reject if you went Active at that threshold

   Adjust the `min_score` input to your target value. The "At min_score = N — X
   of Y proceeds would flip" line updates as you type.

4. **Pick a target min_score** based on the preview:
   - **Conservative**: 40-50 (few flips, mostly trusting LLM)
   - **Balanced**: 50-60 (default)
   - **Aggressive**: 60-70 (more rejects, higher precision)

   Click **Save** next to the min_score input. (No confirmation modal here —
   min_score is enforced only when Active, so changing it while Shadow is harmless.)

5. **Set per-profile overrides if needed**

   In the **Per-profile overrides** table:
   - **Mode toggle**: leave a profile in Shadow while others go Active by
     toggling off `classifier_enabled` on that profile.
   - **Min score override**: blank inherits the global value. Set a number to
     override per profile.

   These changes take effect immediately for the per-profile context cache.

## Flip to Active (Phase 14 — active rollout)

1. **Click the `Active` button** in Settings → Relevancy Classifier → Global mode.

2. **A confirmation modal opens** explaining the effect:
   - Cards with `effective_decision = reject` will stop being created on the
     Task Board
   - Takes effect within ~60s
   - Per-profile `classifier_enabled` toggles become live
   - Rollback: flip back to Shadow here, or set
     `RELEVANCY_CLASSIFIER_ENABLED=false` in n8n cloud env (~30s kill-switch)

   It also shows: "Based on last 7 days at current min_score = N — X of Y
   proceeds (Z%) would have been flipped to reject."

3. **Click "Flip to Active"** to confirm. Toast: `Classifier mode set to active`.

4. **Verify the flip propagated** to n8n's read path:

   ```powershell
   npx tsx scripts/smoke-test-phase-14.ts --mode watch --expect active
   ```

   Polls `/api/profiles/shayan/context` every 10s for up to 120s. Reports when
   `_system.classifier_mode` reflects `active`. Should resolve within 60s on a
   warm Contabo deploy.

5. **Spot-check the Task Board**: open `/tasks` and watch the Todo column for
   the next ~10 minutes. New cards should only appear for proceed verdicts;
   reject verdicts go to the audit log without creating a card.

## Rollback paths

| Trigger | Action | Time to effect |
|---|---|---|
| Want to pause but keep monitoring | Settings → Global mode → **Shadow** → confirm | ~60s |
| Per-profile issue | Settings → per-profile row → **toggle off** | ~60s |
| Crisis — disable everything | SSH to n8n cloud OR Contabo n8n env: `RELEVANCY_CLASSIFIER_ENABLED=false` | ~30s (next workflow execution) |
| Data corruption suspected | Reset to default: `UPDATE system_settings SET value = '"shadow"' WHERE key = 'relevancy.classifier_mode'` | ~60s after cache TTL |

## What the dashboard shows after Active

- **Audit page (`/relevancy-audit`)**: rejects continue to appear here. New
  filter values: `effective_decision = reject` will include both *deterministic*
  rejects (gate 2/3/4/5/6) and *LLM* rejects (gate 1/7/8/9/10/11) and
  *threshold-flipped* rejects (`threshold_flipped = true` rows).
- **Evaluator (`/relevancy-evaluator`)**: unchanged — manual evals always go
  through the same classifier core regardless of mode.
- **Task Board (`/tasks`)**: fewer N/A cards appearing automatically — agents
  spend less time triaging garbage.

## What stays in Shadow mode (won't change after flip)

- The manual evaluator's verdicts are persisted with whatever mode is current
  at the time of the eval — historical verdicts keep their original mode label.
- DLQ rows stay parked until the hourly drain (`/api/cron/relevancy-dlq-drain`)
  succeeds.
- The audit page's "agent override capture" hook on `moveTask` continues to
  write `relevancy_overrides` rows regardless of mode.

## When to flip back to Shadow

- Override rate climbs above ~20% (agents disagreeing with classifier more than
  expected) — see the audit page's override-rate tile.
- DLQ depth grows (classifier write path is failing). Check
  `/api/cron/relevancy-dlq-drain` GH Actions run summaries.
- Cost spike — Gemini token usage from the auto pipeline jumps. Check the
  cost-projection tile if added in Phase 16, or `relevancy_scores.input_tokens +
  output_tokens` summed by day.

If any of those triggers fire, flip to Shadow first (preserves data flow,
turns off routing), investigate, then either tune thresholds + re-flip or
escalate to the classifier-keeper agent.
