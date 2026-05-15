# LLM options and latency for the relevancy classifier

> Reference doc for choosing between LLMs in the `_relevancy-classifier-core` sub-workflow (`hi71jhPU8tmq7hEp`).
>
> **Why this exists**: the 2026-05-15 swap to DeepSeek R1 (full) as primary raised per-execution latency from ~11s (Gemini Flash baseline) to 3–5 minutes. This doc captures the model landscape, trade-offs, and the levers available to bring latency back down without losing classifier quality.

---

## 1. The latency problem in one line

DeepSeek R1 (full) is a **reasoning model** — it generates a long internal chain-of-thought (CoT) before producing the final JSON. Gemini 2.5 Flash and DeepSeek V3 are **not** reasoning models — they answer in one pass.

Same prompt, very different latency profiles. The reasoning IS the cost.

Confirmed via live execution data (e.g., execution 16015, 2026-05-15):
- AI Agent (DeepSeek R1 call): **153,274 ms** (~2m 33s) — 99% of total
- Validate Output Code node: 1,394 ms
- Persist HTTP POST: 72 ms

The workflow itself is fast. The model is what's slow.

---

## 2. What "distilled R1" means

**Knowledge distillation** is a model compression technique. Take a large, strong model (the "teacher") and train a smaller, faster model (the "student") to mimic its outputs. The student learns the teacher's reasoning patterns but with fewer parameters, so it generates tokens faster and burns less compute.

When DeepSeek released R1 (671B parameters total, MoE), they also released **6 distilled variants**. Each is a different open-source base model fine-tuned on R1's reasoning traces:

| Variant ID (OpenRouter) | Base model | Parameters | Typical latency |
|---|---|---|---|
| `deepseek/deepseek-r1` | DeepSeek R1 (MoE) | 671B total / 37B active | 3–5 min |
| `deepseek/deepseek-r1-distill-llama-70b` | Llama 3.3 70B | 70B | 20–40s |
| `deepseek/deepseek-r1-distill-qwen-32b` | Qwen 2.5 32B | 32B | 15–25s |
| `deepseek/deepseek-r1-distill-qwen-14b` | Qwen 2.5 14B | 14B | 8–15s |
| `deepseek/deepseek-r1-distill-llama-8b` | Llama 3.1 8B | 8B | 5–10s |
| `deepseek/deepseek-r1-distill-qwen-7b` | Qwen 2.5 7B | 7B | 5–10s |
| `deepseek/deepseek-r1-distill-qwen-1.5b` | Qwen 2.5 1.5B | 1.5B | 3–5s |

The 70B Llama distill is the most capable; smaller variants trade quality for speed.

---

## 3. Why distilled variants are 15–25× faster

Two reasons:

1. **Smaller models generate tokens faster.** A 70B dense model runs ~3–5× faster per token than full R1 (which has 37B active parameters but a much larger total context).
2. **Shorter reasoning chains.** Distilled models learned the reasoning *style* of R1 but compressed — they produce roughly 5–10× fewer "thinking" tokens before the final answer.

Combined: 15–25× lower latency in practice.

---

## 4. Quality benchmarks (DeepSeek-published)

These compare across hard reasoning tasks. **Higher = better.**

| Model | AIME (math olympiad) | MATH-500 | GPQA Diamond (PhD-level science) | LiveCodeBench |
|---|---|---|---|---|
| Full R1 | ~79% | ~97% | ~71% | ~65% |
| R1-Distill-Llama-70B | ~70% | ~94% | ~65% | ~57% |
| R1-Distill-Qwen-32B | ~72% | ~94% | ~62% | ~57% |
| R1-Distill-Qwen-14b | ~70% | ~94% | ~59% | ~53% |
| R1-Distill-Llama-8b | ~50% | ~89% | ~49% | ~39% |
| Gemini 2.5 Flash | ~50% | ~88% | ~52% | ~37% |

These are **hard reasoning** benchmarks. They aren't a direct measure of how well a model classifies Upwork jobs, but they show the relative reasoning-capability ordering.

---

## 5. Quality vs latency for OUR use case

The relevancy classifier task is **NOT hard reasoning** in the abstract sense. It is:
- Rule-following: 11 hard gates with concrete pass/fail criteria
- Judgment: rubric scoring (7 components) with reasoning per component
- Structured-output emission: a specific JSON shape

For this kind of task:
- The **gap between full R1 and the 70B distill is much smaller** than the math/science benchmarks suggest.
- The reasoning *style* (helpful for borderline judgment calls — e.g., "is this Local SEO job in-bucket for Sana but not Shayan?") is preserved in distilled R1.
- What's lost is **deep multi-step reasoning** (advanced math, complex proofs) — capabilities our task doesn't need.

**Honest read**: full R1 is overkill for relevancy classification. The 70B distill should perform comparably for this use case while being 5–10× faster.

---

## 6. Full trade-off matrix

| Model | Latency | Cost (relative) | Quality on our task | Revert risk | Notes |
|---|---|---|---|---|---|
| **DeepSeek R1 (full)** — current primary | 3–5 min | High | Excellent | — | Reasoning model; major latency hit |
| **DeepSeek R1-Distill-Llama-70B** | 20–40s | Medium | Very good | Low (1-line revert) | Recommended first move |
| **DeepSeek R1-Distill-Qwen-32B** | 15–25s | Medium-Low | Good | Low | Faster but slightly less reasoning |
| **DeepSeek V3** (`deepseek/deepseek-chat`) | 10–20s | Low | Good | Low | Non-reasoning; clean and fast |
| **Gemini 2.5 Flash via OpenRouter** | ~10s | Low | Good (calibrated) | None (was primary before 2026-05-15) | Currently the failover |
| **Gemini 1.5 Flash** | ~5–8s | Very low | Untested | Low | Older, untested calibration |
| **Claude Haiku 4.5** | ~5–10s | Low-Medium | Likely good | Medium | Different vendor; would need calibration |

---

## 7. Levers other than swapping the model

Ranked by impact-per-effort:

### 7.1 Pass OpenRouter `reasoning.max_tokens`
OpenRouter exposes a `reasoning: { max_tokens: N }` parameter on `/chat/completions` for reasoning models like R1. Caps how many tokens R1 can spend "thinking" before producing output. Set to ~1000 and latency drops to ~30–60s.

**Catch**: the n8n LangChain `lmChatOpenAi` sub-node may not expose this parameter directly. Would need to verify it can be passed via `additionalParameters`, or replace the sub-node with a custom HTTP node calling OpenRouter directly. The latter is structurally bigger.

### 7.2 Pin OpenRouter to a specific (faster) provider
OpenRouter routes R1 across multiple inference providers (Fireworks, Together, DeepSeek-direct, etc.) — speeds vary 2–3×. You can pin via `provider.order` in the API call.

**Same exposure problem as 7.1** — may not be reachable through the n8n node.

### 7.3 Reduce `options.maxTokens` from 8192 → 4096
Marginal. Reasoning happens inside the generation budget, so capping output length **truncates the answer JSON before it shortens reasoning**. **Risky** — would lose `components` / `total_score` if response is cut. Don't do this alone.

### 7.4 Shrink the system prompt
DeepSeek's prompt is already condensed (~11.5KB vs Gemini's full 38.7KB). Further trimming saves ~5–10% of input processing time. Negligible gain since output generation dominates.

---

## 8. How to swap models (operationally)

### 8.1 Model-swap checklist

Whenever you change the primary or failover model id, run through this list — skipping any of it leads to a silent failure (timeouts, wrong DB labels, dashboard misreads):

- [ ] **Update the LLM sub-node's `parameters.model.value`** (see §8.2 below).
- [ ] **Update the matching Validate Output twin's `verdict.model` hardcode** so `relevancy_scores.model` distinguishes runs by variant (see §8.3).
- [ ] **Check the API route timeout in `src/app/api/relevancy/evaluate-task/route.ts`** (constant `N8N_TIMEOUT_MS`). The classifier's typical latency must be well under this ceiling, otherwise the manual evaluator will silently fail with `n8n_timeout` even though the n8n run succeeded. See §8.4.
- [ ] **Validate** with `n8n_validate_workflow` after the n8n edit — must come back valid.
- [ ] **Smoke-test** via the manual evaluator (`/relevancy-evaluator`) or wait for a live Vollna fire.
- [ ] **Update `docs/n8n_relevancy_classifier_core_prd.md` §12** with a dated changelog entry.
- [ ] **Update memory** `relevancy_classifier_status.md` "Recent patches" section.

### 8.2 The model id field

The model id lives in **one field** in the sub-workflow `hi71jhPU8tmq7hEp`:

- **Primary LLM sub-node**: `DeepSeek R1 (OpenRouter)`, node id `6b156aeb-60b2-4c0e-afc3-d24f5735f868`
  - **Field**: `parameters.model.value`
  - **Current value (as of 2026-05-15)**: `deepseek/deepseek-r1-distill-llama-70b`
- **Failover LLM sub-node**: `Gemini 2.5 Flash (OpenRouter)`, node id `83310b74-e12c-4091-adf8-23b24fe21705`
  - **Field**: `parameters.model.value`
  - **Current value**: `google/gemini-2.5-flash`

Single `patchNodeField` op via `n8n_update_partial_workflow`. No prompt change, no Validate Output structural change, no connection change.

### 8.3 The `verdict.model` hardcode

Each Validate Output Code node hardcodes a string into `verdict.model`. That string lands in `relevancy_scores.model` and feeds the dashboard's "via X" badge.

- **DeepSeek twin** (id `54869aed-9998-4712-b6a3-513d6005cfe3`) — currently `verdict.model = 'deepseek-r1-distill-llama-70b';`
- **Gemini twin** (id `c6-validate-threshold`) — currently `verdict.model = 'gemini-2.5-flash';`

The dashboard's `RelevancyPanel.modelDisplay` switch uses `model.includes("deepseek")` and `model.includes("gemini")` for prefix matching, so any reasonable id keeps the badge looking right. But for DB queryability, keep the hardcode in sync with the actual model id when swapping.

### 8.4 The API route timeout (`N8N_TIMEOUT_MS`)

**This is the bite-you-silently lever.** The Next.js API route at `src/app/api/relevancy/evaluate-task/route.ts` aborts the fetch to n8n after `N8N_TIMEOUT_MS` milliseconds. If the classifier takes longer than this, n8n still finishes its work and persists the row to `relevancy_scores` — but the result never reaches the browser, the user sees nothing (or a tiny toast that's easy to miss), and the manual evaluator looks broken.

Calibrate this ceiling to ~2× the typical classifier latency:

| Primary model | Typical latency | Recommended `N8N_TIMEOUT_MS` |
|---|---|---|
| Gemini 2.5 Flash | ~10s | `25_000` |
| DeepSeek R1-Distill-Llama-70B (current) | 20–40s | `60_000` |
| DeepSeek R1-Distill-Qwen-32B | 15–25s | `45_000` |
| DeepSeek V3 | 10–20s | `30_000` |
| Full DeepSeek R1 | 180–300s | `360_000` (and consider whether the user will wait that long) |

**Symptom of a too-tight timeout**: `manual_job_evaluations.load_error = 'n8n_timeout'` rows accumulate, all the matching n8n executions show `status: success` with valid verdicts, but the user sees nothing in the dashboard. Fix by bumping `N8N_TIMEOUT_MS` to match the new model's latency profile.

This bug bit on 2026-05-15: the swap from Gemini Flash to DeepSeek R1-Distill-70B raised typical latency from ~10s to 30s, but the API timeout stayed at 25s. Fixed by bumping to 60s.

---

## 9. Recommendation by scenario

| Scenario | Choice |
|---|---|
| **Want maximum quality, latency doesn't matter** | Full R1 (current) |
| **Want big latency win, minimal quality risk** | R1-Distill-Llama-70B |
| **Need speed under 30s, OK with slight quality drop** | R1-Distill-Qwen-32B |
| **Need a known-good fast baseline RIGHT NOW** | Revert to Gemini 2.5 Flash primary |
| **Latency must be under 15s** | DeepSeek V3 (`deepseek-chat`) OR small distill (8B/14B) |
| **In Active mode, blocking proposal pipeline** | Revert to Gemini OR move to 70B distill ASAP |

---

## 10. What today's session left in place (regardless of model choice)

The following fixes shipped 2026-05-15 are **keepers** independent of which LLM is primary:

1. **C12 verdict-recovery chain** (`c12-return-verdict`) — now finds the DeepSeek twin's output. Fixed the "every DeepSeek proceed clobbered to synthesized fallback" regression.
2. **C12 synthesized-fallback `model: null`** — hides the misleading "via Gemini 2.5 Flash" badge on genuine error fallbacks where no model actually ran.
3. **Validate Output rubric-wrapper normalization** (both twins) — unwraps `verdict.rubric.{components, total_score, tier}` to top level and renames `components.<k>.score` → `.value` if the LLM emits the wrapped shape. Idempotent for the correct shape.
4. **Mode A OUTPUT RULES bullet** in both AI Agent system prompts — explicit instruction that `components` / `total_score` / `tier` are top-level siblings, not nested.

These survive any future model swap.

---

## 11. Open questions / future work

- **Validate distilled R1's calibration in production.** Spot-check 20–30 verdicts manually for borderline cases.
- **Build a model-selection routing layer.** Could route easy jobs (clean deterministic gate pass) to a fast model and borderline jobs (multi-gate uncertainty) to full R1. Adds complexity; defer until volume justifies.
- **Per-profile model preference**. Some profiles might benefit from heavier reasoning (Khansa's AI/full-stack jobs are stylistically harder than Craig's WordPress jobs).
- **Investigate `reasoning.max_tokens` passthrough via n8n node**. If reachable, that's a finer-grained lever than swapping models entirely.
- **Cost tracking**. Currently no telemetry on per-model spend; would help inform future swaps.

---

## 12. Sources

- DeepSeek R1 release blog post: https://api-docs.deepseek.com/news/news250120 (publication date 2025-01-20)
- DeepSeek R1 technical report (arXiv 2501.12948)
- OpenRouter model catalog: https://openrouter.ai/models
- Live execution data, `_relevancy-classifier-core` workflow on `ikonicdev.app.n8n.cloud`

---

*Last updated: 2026-05-15. Maintained alongside `docs/n8n_relevancy_classifier_core_prd.md` §12 and `docs/relevancy/mode_a_prompt.md`.*
