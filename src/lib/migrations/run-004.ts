import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "@vercel/postgres";

async function run() {
  console.log("Running migration 004: cyberpunk schema...\n");

  // Jobs table
  console.log("Adding columns to jobs table...");
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS connects_used INTEGER DEFAULT 0`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'low'`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(100)`;
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ`;
  console.log("  ✓ jobs columns added");

  // Profiles table
  console.log("Adding columns to profiles table...");
  await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS niche VARCHAR(50)`;
  await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS connects_budget INTEGER DEFAULT 150`;
  console.log("  ✓ profiles columns added");

  // Agents table
  console.log("Adding columns to agents table...");
  await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS bonus_earned DECIMAL(10,2) DEFAULT 0`;
  console.log("  ✓ agents columns added");

  // Backfill niche from stack
  console.log("Backfilling niche from stack...");
  const nicheResult = await sql`UPDATE profiles SET niche = stack WHERE niche IS NULL AND stack IS NOT NULL`;
  console.log(`  ✓ ${nicheResult.rowCount} profiles updated`);

  // Backfill stage_entered_at from updated_at
  console.log("Backfilling stage_entered_at from updated_at...");
  const stageResult = await sql`UPDATE jobs SET stage_entered_at = updated_at WHERE stage_entered_at IS NULL`;
  console.log(`  ✓ ${stageResult.rowCount} jobs updated`);

  // Backfill priority from budget_max
  console.log("Backfilling priority from budget_max...");
  const priorityResult = await sql`
    UPDATE jobs SET priority = CASE
      WHEN budget_max >= 5000 THEN 'high'
      WHEN budget_max >= 1000 THEN 'medium'
      ELSE 'low'
    END WHERE priority = 'low' AND budget_max IS NOT NULL
  `;
  console.log(`  ✓ ${priorityResult.rowCount} jobs updated`);

  console.log("\n✓ Migration 004 complete!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
