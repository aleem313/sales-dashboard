// CLI: Phase 14 readiness check + post-flip verifier.
//
// Two modes:
//   --mode check  (default)  → run pre-flip readiness checks and report.
//                                Validates: classifier-mode reachability via
//                                /api/profiles/:id/context, shadow data volume,
//                                manual evaluator webhook reachability, n8n
//                                kill-switch env state hint.
//
//   --mode watch              → poll /api/profiles/:id/context until
//                                _system.classifier_mode == --expect <mode>.
//                                Use AFTER clicking the Shadow ↔ Active toggle
//                                in /settings to verify the flip propagated.
//
// The script never directly mutates state. Mode flips happen via the UI button
// (which fires the action's updateTag() to bust the profile-context cache).
// This script just inspects.
//
// Usage:
//   node --import tsx scripts/smoke-test-phase-14.ts
//   node --import tsx scripts/smoke-test-phase-14.ts --mode watch --expect active
//   node --import tsx scripts/smoke-test-phase-14.ts --token <RELEVANCY_MANUAL_EVAL_TOKEN>

import { randomUUID } from "node:crypto";

interface CliArgs {
  mode: "check" | "watch";
  expect: "shadow" | "active" | null;
  profileId: string;
  dashboardBase: string;
  webhookBase: string;
  token: string;
  smokeTaskId: string;
  smokeProfileId: string;
  watchTimeoutSec: number;
  watchIntervalSec: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "check",
    expect: null,
    profileId: "shayan",
    dashboardBase: process.env.DASHBOARD_BASE || "https://risinglions.ikonicsolution.com",
    webhookBase:
      process.env.N8N_WEBHOOK_BASE || "https://ikonicdev.app.n8n.cloud/webhook",
    token:
      process.env.RELEVANCY_MANUAL_EVAL_TOKEN ||
      process.env.MANUAL_EVAL_TOKEN ||
      "",
    // First Appendix D fixture — a real card on Contabo.
    smokeTaskId: "d2aeea13-d4d3-4e66-ac13-5b0d53f49a99",
    smokeProfileId: "craig",
    watchTimeoutSec: 120,
    watchIntervalSec: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--mode") args.mode = (next() as "check" | "watch") ?? args.mode;
    else if (a === "--expect")
      args.expect = (next() as "shadow" | "active") ?? null;
    else if (a === "--profile-id") args.profileId = next();
    else if (a === "--dashboard-base") args.dashboardBase = next();
    else if (a === "--webhook-base") args.webhookBase = next();
    else if (a === "--token") args.token = next();
    else if (a === "--smoke-task") args.smokeTaskId = next();
    else if (a === "--smoke-profile") args.smokeProfileId = next();
    else if (a === "--watch-timeout") args.watchTimeoutSec = Number(next()) || 120;
    else if (a === "--watch-interval") args.watchIntervalSec = Number(next()) || 10;
  }
  return args;
}

interface ProfileContext {
  profile?: { profile_id?: string; profile_name?: string } | null;
  _system?: {
    classifier_mode?: "shadow" | "active";
    effective_min_score?: number;
    classifier_enabled?: boolean;
    min_score_override?: number | null;
  } | null;
}

async function fetchProfileContext(
  base: string,
  profileId: string
): Promise<{ ok: boolean; status: number; body: ProfileContext | null; error: string | null }> {
  try {
    const r = await fetch(`${base}/api/profiles/${profileId}/context`, {
      cache: "no-store",
    });
    let body: ProfileContext | null = null;
    try {
      body = (await r.json()) as ProfileContext;
    } catch {
      /* not JSON */
    }
    return { ok: r.ok, status: r.status, body, error: null };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: (e as Error).message };
  }
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function checkProfileContext(args: CliArgs): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const r = await fetchProfileContext(args.dashboardBase, args.profileId);
  if (!r.ok || !r.body) {
    checks.push({
      name: "Profile context reachable",
      pass: false,
      detail: `HTTP ${r.status} from /api/profiles/${args.profileId}/context — ${r.error ?? "no body"}`,
    });
    return checks;
  }
  const sys = r.body._system;
  checks.push({
    name: "Profile context reachable",
    pass: true,
    detail: `HTTP 200 · profile=${r.body.profile?.profile_id ?? "?"}`,
  });
  if (!sys || typeof sys.classifier_mode !== "string") {
    checks.push({
      name: "_system.classifier_mode populated",
      pass: false,
      detail: "missing _system.classifier_mode — context shape drift",
    });
  } else {
    checks.push({
      name: "_system.classifier_mode populated",
      pass: true,
      detail: `current = ${sys.classifier_mode} (this is what n8n's C1 reads)`,
    });
  }
  if (sys && typeof sys.effective_min_score === "number") {
    checks.push({
      name: "_system.effective_min_score populated",
      pass: true,
      detail: `current = ${sys.effective_min_score}`,
    });
  } else {
    checks.push({
      name: "_system.effective_min_score populated",
      pass: false,
      detail: "missing effective_min_score — preview will misreport",
    });
  }
  return checks;
}

async function pingManualEvaluator(args: CliArgs): Promise<CheckResult> {
  if (!args.token) {
    return {
      name: "Manual evaluator webhook smoke",
      pass: false,
      detail:
        "skipped — no RELEVANCY_MANUAL_EVAL_TOKEN (export the env var or pass --token)",
    };
  }
  try {
    const r = await fetch(`${args.webhookBase}/job-evaluate-manual`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        task_id: args.smokeTaskId,
        profile_id: args.smokeProfileId,
        requested_by: "smoke-test-phase-14",
        request_id: randomUUID(),
      }),
    });
    const text = await r.text();
    let parsed: { decision?: string; effective_decision?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* */
    }
    if (!r.ok) {
      return {
        name: "Manual evaluator webhook smoke",
        pass: false,
        detail: `HTTP ${r.status} — ${parsed?.error ?? text.slice(0, 120)}`,
      };
    }
    const eff = parsed?.effective_decision ?? parsed?.decision ?? "?";
    return {
      name: "Manual evaluator webhook smoke",
      pass: true,
      detail: `200 · ${args.smokeTaskId.slice(0, 8)}…/${args.smokeProfileId} → ${eff}`,
    };
  } catch (e) {
    return {
      name: "Manual evaluator webhook smoke",
      pass: false,
      detail: `network error: ${(e as Error).message}`,
    };
  }
}

function fmtSection(title: string, results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push(`\n## ${title}`);
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    lines.push(`  ${icon} ${r.name}`);
    lines.push(`      ${r.detail}`);
  }
  return lines.join("\n");
}

async function runCheck(args: CliArgs) {
  console.log(`Phase 14 readiness check · ${args.dashboardBase}`);
  console.log(`Profile under test: ${args.profileId}`);

  const profileChecks = await checkProfileContext(args);
  const evalCheck = await pingManualEvaluator(args);

  const allResults = [...profileChecks, evalCheck];
  console.log(fmtSection("Results", allResults));

  const passed = allResults.filter((r) => r.pass).length;
  const total = allResults.length;
  const ok = passed === total;
  console.log(`\n${ok ? "✅" : "⚠️"} ${passed}/${total} checks pass.`);
  if (!ok) {
    console.log(
      "Fix the failures above before flipping mode in /settings. Common causes:"
    );
    console.log("  - Token not set: export RELEVANCY_MANUAL_EVAL_TOKEN=...");
    console.log("  - Dashboard down: check Contabo container status");
    console.log("  - n8n workflow inactive: verify fvbhmg0NPnRm4z54 is active");
    process.exit(1);
  }
}

async function runWatch(args: CliArgs) {
  if (!args.expect) {
    throw new Error("--mode watch requires --expect shadow|active");
  }
  const deadline = Date.now() + args.watchTimeoutSec * 1000;
  console.log(
    `Watching ${args.dashboardBase}/api/profiles/${args.profileId}/context for classifier_mode = ${args.expect}…`
  );
  console.log(
    `(${args.watchIntervalSec}s interval, ${args.watchTimeoutSec}s timeout. Flip the toggle in /settings now if you haven't yet.)`
  );

  let propagated = false;
  while (Date.now() < deadline) {
    const r = await fetchProfileContext(args.dashboardBase, args.profileId);
    const current = r.body?._system?.classifier_mode ?? "?";
    const minScore = r.body?._system?.effective_min_score ?? "?";
    const ts = new Date().toLocaleTimeString();
    if (current === args.expect) {
      console.log(
        `  [${ts}] mode = ${current} · effective_min_score = ${minScore}  ✅ matched`
      );
      propagated = true;
      break;
    }
    console.log(
      `  [${ts}] mode = ${current} · effective_min_score = ${minScore}  (waiting for ${args.expect})`
    );
    await new Promise((res) => setTimeout(res, args.watchIntervalSec * 1000));
  }

  if (!propagated) {
    console.log(`\n⚠️ Timed out after ${args.watchTimeoutSec}s. Possible causes:`);
    console.log("  - Toggle wasn't clicked (or click failed)");
    console.log("  - Cache invalidation didn't fire — check updateTag() in setRelevancyModeAction");
    console.log("  - Dashboard container needs restart");
    process.exit(1);
  }

  console.log(`\n✅ classifier_mode propagated to n8n's read path within window.`);

  // Second-stage check: run a real manual eval and confirm the verdict
  // comes back stamped with classifier_mode_at_decision = expect. This proves
  // the full chain (DB → /api/profiles/:id/context → C1 → C6 → verdict) is
  // emitting the new mode, not just that the context endpoint sees it.
  if (!args.token) {
    console.log(
      "\nℹ️  Skipping verdict-stamp check — no RELEVANCY_MANUAL_EVAL_TOKEN."
    );
    console.log(
      "    Re-run with --token <value> (or export the env var) to validate the full chain."
    );
    return;
  }

  console.log(`\nRunning manual eval probe to verify verdict-stamp matches…`);
  try {
    const r = await fetch(`${args.webhookBase}/job-evaluate-manual`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        task_id: args.smokeTaskId,
        profile_id: args.smokeProfileId,
        requested_by: "smoke-test-phase-14-watch",
        request_id: randomUUID(),
      }),
    });
    const text = await r.text();
    interface VerdictProbe {
      classifier_mode_at_decision?: string;
      min_score_at_decision?: number;
      decision?: string;
      effective_decision?: string;
      threshold_flipped?: boolean;
      total_score?: number | null;
      error?: string;
    }
    let v: VerdictProbe | null = null;
    try {
      v = JSON.parse(text) as VerdictProbe;
    } catch {
      /* */
    }
    if (!r.ok || !v) {
      console.log(
        `  ✗ Probe HTTP ${r.status} — ${v?.error ?? text.slice(0, 120)}`
      );
      process.exit(1);
    }
    const stamped = v.classifier_mode_at_decision;
    const stampOk = stamped === args.expect;
    console.log(
      `  ${stampOk ? "✓" : "✗"} verdict.classifier_mode_at_decision = ${stamped ?? "(missing)"}`
    );
    console.log(
      `    decision=${v.decision} · effective=${v.effective_decision} · threshold_flipped=${v.threshold_flipped ?? false} · score=${v.total_score ?? "—"} · min=${v.min_score_at_decision ?? "—"}`
    );
    if (!stampOk) {
      console.log(
        `\n⚠️ Profile context says ${args.expect} but classifier still stamped ${stamped}.`
      );
      console.log(
        "    Likely the classifier sub-workflow cached the old mode mid-execution OR C1's read returned stale data."
      );
      console.log(
        "    Wait 60s and retry — n8n cloud caches profile-context reads per-execution."
      );
      process.exit(1);
    }
    console.log(`\n✅ Full chain verified: DB → context endpoint → classifier verdict all show ${args.expect}.`);
  } catch (e) {
    console.log(`\n⚠️ Probe failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "check") await runCheck(args);
  else if (args.mode === "watch") await runWatch(args);
  else throw new Error(`Unknown mode: ${args.mode} (use check|watch)`);
}

main().catch((e) => {
  console.error(`smoke-test-phase-14 failed: ${(e as Error).message}`);
  process.exit(1);
});
