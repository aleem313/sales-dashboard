// CLI: Phase 11 smoke test runner.
//
// Replays the 20 frozen Appendix D fixtures through the manual evaluator's
// n8n webhook (skipping the dashboard route's NextAuth gate — the route is a
// thin auth/rate-limit wrapper, the classifier path is identical). Captures
// each verdict, scores against the expected outcome, and writes a timestamped
// results JSON + prints a markdown summary table to stdout.
//
// Usage:
//   node --import tsx scripts/smoke-test-phase-11.ts
//   node --import tsx scripts/smoke-test-phase-11.ts --webhook-base https://ikonicdev.app.n8n.cloud --token "<TOKEN>"
//   node --import tsx scripts/smoke-test-phase-11.ts --only 1,12,17    # subset
//   node --import tsx scripts/smoke-test-phase-11.ts --concurrency 2   # default 1
//
// Required env (or CLI flags):
//   RELEVANCY_MANUAL_EVAL_TOKEN — Bearer token attached to n8n's J1 Webhook credential.
//                                 (MANUAL_EVAL_TOKEN accepted as transitional alias.)
//   N8N_WEBHOOK_BASE            — defaults to https://ikonicdev.app.n8n.cloud/webhook
//
// Output:
//   docs/phase-11-results/<ISO-timestamp>.json     — full per-fixture data
//   docs/phase-11-results/<ISO-timestamp>.md       — human-readable summary
//   stdout — same markdown summary
//
// Pass criterion (Appendix D.3):
//   ≥17/20 decision agreement → ship. 14–16 → tighten min_score, re-run.
//   <14 → escalate (PRD example library + prompt rework).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";

interface Fixture {
  id: number;
  task_id: string;
  profile_id: string;
  title: string;
  captured_reasons: string[];
  client_signal: Record<string, unknown>;
  category:
    | "single_reason"
    | "multi_reason"
    | "candidate_false_reject"
    | "candidate_borderline";
  expected_decision: "proceed" | "reject" | "review";
  expected_gates: number[];
  expected_reasons: string[];
  borderline?: boolean;
  notes: string;
}

interface FixtureFile {
  _meta: Record<string, unknown>;
  fixtures: Fixture[];
}

interface Verdict {
  decision?: "proceed" | "reject" | "review";
  effective_decision?: "proceed" | "reject" | "review";
  threshold_flipped?: boolean;
  total_score?: number | null;
  tier?: string | null;
  confidence?: number | null;
  rejection_reasons?: string[] | null;
  gates_passed?: number[] | null;
  gates_failed?: number[] | null;
  summary?: string | null;
  classifier_mode_at_decision?: string;
  min_score_at_decision?: number | null;
  criteria_version?: string;
  prompt_version?: string;
  model?: string;
  task?: unknown;
  error?: string;
  detail?: string;
}

interface FixtureResult {
  fixture: Fixture;
  ok: boolean;
  http_status: number;
  latency_ms: number;
  verdict: Verdict | null;
  error: string | null;
  scoring: {
    decision_match: boolean;
    reason_overlap: boolean | null; // null for non-single_reason cases
    borderline_credit: number;       // 0 / 0.5 / 1
    points: number;
  };
}

interface CliArgs {
  webhookBase: string;
  token: string;
  only: number[] | null;
  concurrency: number;
  fixturesPath: string;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = {
    webhookBase: process.env.N8N_WEBHOOK_BASE || "https://ikonicdev.app.n8n.cloud/webhook",
    token:
      process.env.RELEVANCY_MANUAL_EVAL_TOKEN ||
      process.env.MANUAL_EVAL_TOKEN ||
      "",
    only: null as number[] | null,
    concurrency: 1,
    fixturesPath: "docs/phase-11-fixtures.json",
    outDir: "docs/phase-11-results",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--webhook-base") args.webhookBase = next();
    else if (a === "--token") args.token = next();
    else if (a === "--only") {
      args.only = next()
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    } else if (a === "--concurrency") args.concurrency = Number(next()) || 1;
    else if (a === "--fixtures") args.fixturesPath = next();
    else if (a === "--out-dir") args.outDir = next();
  }

  if (!args.token) {
    throw new Error(
      "RELEVANCY_MANUAL_EVAL_TOKEN env var or --token flag is required (the n8n webhook bearer)"
    );
  }
  return args;
}

async function runFixture(
  fixture: Fixture,
  webhookUrl: string,
  token: string
): Promise<FixtureResult> {
  const requestId = randomUUID();
  const t0 = Date.now();
  let httpStatus = 0;
  let verdict: Verdict | null = null;
  let errMsg: string | null = null;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        task_id: fixture.task_id,
        profile_id: fixture.profile_id,
        requested_by: "smoke-test-phase-11",
        request_id: requestId,
      }),
    });
    httpStatus = res.status;
    const text = await res.text();
    try {
      verdict = text ? (JSON.parse(text) as Verdict) : null;
    } catch {
      errMsg = `non-JSON response: ${text.slice(0, 200)}`;
    }
    if (!res.ok && verdict?.error) {
      errMsg = `${verdict.error}: ${verdict.detail ?? ""}`.trim();
    }
  } catch (e) {
    errMsg = (e as Error).message;
  }
  const latency = Date.now() - t0;

  const scoring = scoreFixture(fixture, verdict);
  return {
    fixture,
    ok: httpStatus >= 200 && httpStatus < 300 && verdict != null && !verdict.error,
    http_status: httpStatus,
    latency_ms: latency,
    verdict,
    error: errMsg,
    scoring,
  };
}

function scoreFixture(fixture: Fixture, verdict: Verdict | null): FixtureResult["scoring"] {
  if (!verdict) {
    return { decision_match: false, reason_overlap: null, borderline_credit: 0, points: 0 };
  }
  const eff = verdict.effective_decision ?? verdict.decision;
  const decisionMatch = eff === fixture.expected_decision;

  // Reason overlap only meaningful when the fixture has tagged reasons AND the verdict rejected.
  let reasonOverlap: boolean | null = null;
  if (fixture.category === "single_reason" || fixture.category === "multi_reason") {
    const verdictReasons = (verdict.rejection_reasons ?? []).map((r) => r.toLowerCase());
    const verdictGates = new Set(verdict.gates_failed ?? []);
    const reasonHit = fixture.expected_reasons.some((r) =>
      verdictReasons.includes(r.toLowerCase())
    );
    const gateHit = fixture.expected_gates.some((g) => verdictGates.has(g));
    reasonOverlap = reasonHit || gateHit;
  }

  // Borderline scoring (D.3): half-credit when classifier disagrees but is internally consistent.
  let borderlineCredit = 0;
  let points = decisionMatch ? 1 : 0;
  if (fixture.borderline) {
    if (decisionMatch) {
      borderlineCredit = 1;
      points = 1;
    } else if (eff === "review") {
      borderlineCredit = 0.5;
      points = 0.5;
    } else {
      borderlineCredit = 0;
      points = 0;
    }
  }
  return { decision_match: decisionMatch, reason_overlap: reasonOverlap, borderline_credit: borderlineCredit, points };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => next());
  await Promise.all(workers);
  return results;
}

function buildSummaryMd(results: FixtureResult[], runMeta: Record<string, unknown>): string {
  const total = results.length;
  const httpOk = results.filter((r) => r.ok).length;
  const decisionMatches = results.filter((r) => r.scoring.decision_match).length;
  const reasonOverlapTotal = results.filter((r) => r.scoring.reason_overlap === true).length;
  const reasonOverlapDenom = results.filter((r) => r.scoring.reason_overlap !== null).length;
  const points = results.reduce((acc, r) => acc + r.scoring.points, 0);
  const agreementPct = ((points / total) * 100).toFixed(1);
  // Scale to subset size — Appendix D pass criterion is 85%. For the full 20
  // fixture run that's 17; partial runs (--only) scale proportionally.
  const passTarget = Math.ceil(total * 0.85);
  const marginalTarget = Math.ceil(total * 0.7);
  const pass = points >= passTarget;
  const marginal = !pass && points >= marginalTarget;

  const lines: string[] = [];
  lines.push(`# Phase 11 — Smoke Test Results`);
  lines.push("");
  lines.push(`**Run:** ${runMeta.timestamp} · **Webhook:** ${runMeta.webhook_url}`);
  lines.push(`**Fixtures:** ${total} · **HTTP OK:** ${httpOk}/${total} · **Concurrency:** ${runMeta.concurrency}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Decision agreement | **${points}/${total}** (${agreementPct}%) |`);
  lines.push(`| Exact decision match | ${decisionMatches}/${total} |`);
  lines.push(`| Reason overlap (rejects only) | ${reasonOverlapTotal}/${reasonOverlapDenom} |`);
  lines.push(`| Pass target | ≥ ${passTarget}/${total} (85%) |`);
  lines.push(`| Verdict | ${pass ? "✅ **PASS — proceed to Phase 12 (shadow rollout)**" : marginal ? "⚠️ **MARGINAL — bump min_score via /settings and re-run**" : "❌ **FAIL — prompt rework needed before shadow**"} |`);
  lines.push("");
  lines.push(`## Per-fixture results`);
  lines.push("");
  lines.push(`| # | Profile | Expected | Got | Score | Reason overlap | Latency | Notes |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const f = r.fixture;
    const eff = r.verdict?.effective_decision ?? r.verdict?.decision ?? "—";
    const points = r.scoring.points;
    const pointsCell = points === 1 ? "✓ 1.0" : points === 0.5 ? "◐ 0.5" : "✗ 0";
    const overlapCell =
      r.scoring.reason_overlap === null ? "n/a" : r.scoring.reason_overlap ? "✓" : "✗";
    const totalScore = r.verdict?.total_score != null ? `${r.verdict.total_score}` : "—";
    const errCell = r.error ? ` · err: ${r.error.slice(0, 60)}` : "";
    lines.push(
      `| ${f.id} | ${f.profile_id} | ${f.expected_decision} | ${eff} (${totalScore}) | ${pointsCell} | ${overlapCell} | ${r.latency_ms}ms | ${f.notes.slice(0, 80)}${errCell} |`
    );
  }
  lines.push("");
  lines.push(`## Failures (detail)`);
  lines.push("");
  const failures = results.filter((r) => !r.scoring.decision_match && !r.error);
  if (failures.length === 0) {
    lines.push(`_(no decision mismatches that completed cleanly)_`);
  } else {
    for (const r of failures) {
      lines.push(`### Fixture #${r.fixture.id} — ${r.fixture.profile_id}: ${r.fixture.title}`);
      lines.push(`- **Expected**: ${r.fixture.expected_decision} (gates ${r.fixture.expected_gates.join(",") || "—"}, reasons ${JSON.stringify(r.fixture.expected_reasons)})`);
      lines.push(`- **Got**: ${r.verdict?.effective_decision ?? r.verdict?.decision} (gates_failed ${(r.verdict?.gates_failed ?? []).join(",") || "—"}, reasons ${JSON.stringify(r.verdict?.rejection_reasons ?? [])})`);
      lines.push(`- **Score**: ${r.verdict?.total_score ?? "—"}/100 · confidence ${r.verdict?.confidence ?? "—"}`);
      if (r.verdict?.summary) {
        lines.push(`- **Classifier summary**: ${r.verdict.summary}`);
      }
      lines.push(`- **Fixture notes**: ${r.fixture.notes}`);
      lines.push("");
    }
  }
  const transportErrors = results.filter((r) => r.error);
  if (transportErrors.length) {
    lines.push(`## Transport errors`);
    lines.push("");
    for (const r of transportErrors) {
      lines.push(`- **#${r.fixture.id}** (HTTP ${r.http_status}): ${r.error}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturesAbs = resolvePath(process.cwd(), args.fixturesPath);
  const fixtureFile: FixtureFile = JSON.parse(readFileSync(fixturesAbs, "utf-8"));
  let fixtures = fixtureFile.fixtures;
  if (args.only) {
    const set = new Set(args.only);
    fixtures = fixtures.filter((f) => set.has(f.id));
  }
  if (fixtures.length === 0) {
    throw new Error("No fixtures selected");
  }

  const webhookUrl = `${args.webhookBase.replace(/\/$/, "")}/job-evaluate-manual`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runMeta = {
    timestamp,
    webhook_url: webhookUrl,
    fixtures_path: args.fixturesPath,
    concurrency: args.concurrency,
    fixture_ids: fixtures.map((f) => f.id),
  };

  console.log(
    `Running ${fixtures.length} fixture(s) → ${webhookUrl} · concurrency=${args.concurrency}`
  );

  const results = await runWithConcurrency(fixtures, args.concurrency, async (f) => {
    const r = await runFixture(f, webhookUrl, args.token);
    const status = r.error ? `ERR ${r.error.slice(0, 40)}` : r.verdict?.effective_decision ?? "?";
    console.log(`  #${String(f.id).padStart(2, " ")} ${f.profile_id.padEnd(8)} ${f.expected_decision.padEnd(7)} → ${status.padEnd(8)} ${r.latency_ms}ms ${r.scoring.decision_match ? "✓" : "✗"}`);
    return r;
  });

  // Persist + emit summary
  const outDirAbs = resolvePath(process.cwd(), args.outDir);
  mkdirSync(outDirAbs, { recursive: true });
  const jsonPath = `${outDirAbs}/${timestamp}.json`;
  const mdPath = `${outDirAbs}/${timestamp}.md`;
  writeFileSync(jsonPath, JSON.stringify({ run_meta: runMeta, results }, null, 2));
  const md = buildSummaryMd(results, runMeta);
  writeFileSync(mdPath, md);

  console.log("\n" + md);
  console.log(`\nResults written to:\n  ${jsonPath}\n  ${mdPath}`);
}

main().catch((e) => {
  console.error(`smoke-test failed: ${(e as Error).message}`);
  process.exit(1);
});
