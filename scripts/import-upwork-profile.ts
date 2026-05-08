// CLI: import an extracted Upwork profile JSON into upwork_profile_snapshots.
//
// Usage:
//   node --import tsx scripts/import-upwork-profile.ts --profile-id <slug>     --json docs/profiles/<X>.json
//   node --import tsx scripts/import-upwork-profile.ts --profile-name <name>   --json docs/profiles/<X>.json
//
// Examples:
//   node --import tsx scripts/import-upwork-profile.ts --profile-id shayan         --json docs/profiles/Shayan.json
//   node --import tsx scripts/import-upwork-profile.ts --profile-name "Shayan"     --json docs/profiles/Shayan.json
//
// Behavior:
//   - Looks up the profile in the `profiles` table. With --profile-id, exact match on profiles.profile_id.
//     With --profile-name, case-insensitive match on profiles.profile_name. Errors loudly if zero or multiple matches.
//   - Reads + parses the JSON file.
//   - Calls saveUpworkProfileSnapshot (the shared data-layer function) which atomically demotes the
//     previous current snapshot and inserts the new row.
//   - Prints a one-line summary: profile, snapshot id, whether a previous row was replaced, and key stats.

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { sql } from "../src/lib/db";
import { saveUpworkProfileSnapshot } from "../src/lib/data";

type Args = {
  profileId?: string;
  profileName?: string;
  jsonPath?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--profile-id") args.profileId = next();
    else if (a === "--profile-name") args.profileName = next();
    else if (a === "--json") args.jsonPath = next();
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Usage:
  scripts/import-upwork-profile.ts --profile-id <slug>    --json <path>
  scripts/import-upwork-profile.ts --profile-name <name>  --json <path>

Required:
  --json <path>         Path to the extracted JSON (output of docs/profiles/extract-profile.js).

One of:
  --profile-id <slug>   The profiles.profile_id slug (e.g. "shayan"). Exact match.
  --profile-name <name> The profiles.profile_name (e.g. "Shayan"). Case-insensitive, must be unique.
`);
}

async function lookupProfile(args: Args): Promise<{ profile_id: string; profile_name: string }> {
  if (args.profileId) {
    const r = await sql<{ profile_id: string; profile_name: string }>`
      SELECT profile_id, profile_name FROM profiles WHERE profile_id = ${args.profileId} LIMIT 1
    `;
    if (r.rows.length === 0) {
      throw new Error(`No profile found with profile_id = "${args.profileId}". Check the slug.`);
    }
    return r.rows[0];
  }
  if (args.profileName) {
    const r = await sql<{ profile_id: string; profile_name: string }>`
      SELECT profile_id, profile_name FROM profiles WHERE LOWER(profile_name) = LOWER(${args.profileName})
    `;
    if (r.rows.length === 0) {
      throw new Error(`No profile found with profile_name = "${args.profileName}".`);
    }
    if (r.rows.length > 1) {
      const ids = r.rows.map((row) => row.profile_id).join(", ");
      throw new Error(
        `Multiple profiles found with profile_name = "${args.profileName}": ${ids}. ` +
        `Use --profile-id <slug> to disambiguate.`
      );
    }
    return r.rows[0];
  }
  throw new Error("Specify either --profile-id or --profile-name. Run with --help for usage.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.jsonPath) {
    console.error("Error: --json <path> is required.");
    printHelp();
    process.exit(2);
  }
  if (!args.profileId && !args.profileName) {
    console.error("Error: --profile-id or --profile-name is required.");
    printHelp();
    process.exit(2);
  }

  const absJsonPath = resolvePath(process.cwd(), args.jsonPath);
  const raw = readFileSync(absJsonPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse JSON at ${absJsonPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  const profile = await lookupProfile(args);

  const result = await saveUpworkProfileSnapshot(profile.profile_id, json);

  // Read back the new row's hot stats for the summary line.
  const verify = await sql<{
    name: string | null;
    rating: string | null;
    job_success_score: number | null;
    total_jobs_worked: number | null;
    total_hours: string | null;
    extracted_at: string;
  }>`
    SELECT name, rating, job_success_score, total_jobs_worked, total_hours, extracted_at
    FROM upwork_profile_snapshots WHERE id = ${result.id}
  `;
  const v = verify.rows[0];

  console.log(
    `✓ Saved snapshot for "${profile.profile_name}" (profile_id=${profile.profile_id})`,
  );
  console.log(`  id           : ${result.id}`);
  console.log(`  replaced     : ${result.replaced}`);
  if (v) {
    console.log(`  name         : ${v.name ?? "(null)"}`);
    console.log(`  rating       : ${v.rating ?? "(null)"}`);
    console.log(`  jss          : ${v.job_success_score ?? "(null)"}`);
    console.log(`  jobs / hours : ${v.total_jobs_worked ?? "?"} / ${v.total_hours ?? "?"}`);
    console.log(`  extracted_at : ${v.extracted_at}`);
  }
}

main().catch((err) => {
  console.error(`✗ Import failed: ${(err as Error).message}`);
  process.exit(1);
});
