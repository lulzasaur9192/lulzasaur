/**
 * One-time migration: add "planned" enum value + new columns for planner/dispatcher.
 * Run with: npx tsx scripts/migrate-planner.ts
 */
import { config } from "dotenv";
config();

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lulzasaur:lulzasaur@localhost:5432/lulzasaur";
const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log("Running planner migration...");

  // 1. Add "planned" to task_status enum (idempotent)
  try {
    await sql`ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'planned' BEFORE 'pending'`;
    console.log("  ✓ Added 'planned' to task_status enum");
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      console.log("  - 'planned' already exists in task_status enum");
    } else {
      throw e;
    }
  }

  // 2. Add depends_on column (idempotent)
  try {
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on jsonb DEFAULT '[]'`;
    console.log("  ✓ Added depends_on column");
  } catch (e: any) {
    console.log(`  - depends_on: ${e.message}`);
  }

  // 3. Add suggested_soul column (idempotent)
  try {
    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suggested_soul text`;
    console.log("  ✓ Added suggested_soul column");
  } catch (e: any) {
    console.log(`  - suggested_soul: ${e.message}`);
  }

  // 4. Add index on suggested_soul (idempotent)
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_suggested_soul ON tasks (suggested_soul)`;
    console.log("  ✓ Added idx_tasks_suggested_soul index");
  } catch (e: any) {
    console.log(`  - index: ${e.message}`);
  }

  console.log("Migration complete.");
  await sql.end();
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
