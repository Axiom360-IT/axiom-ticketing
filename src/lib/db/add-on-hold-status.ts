import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: add the "On hold" ticket status + the SLA-pause column
 * (mirrors migration 0026). The status CHECK is a closed set, so it's dropped
 * and re-added with the new value; `sla_paused_at` is added IF NOT EXISTS.
 *
 * Runs through the app's OWN Neon connection. Safe to re-run.
 *
 * Run via `pnpm db:add-on-hold-status`.
 */
async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" DROP CONSTRAINT IF EXISTS "tickets_status_check"`,
  );
  await db.execute(sql`
    ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_check"
      CHECK ("status" IN ('draft','open','in_progress','awaiting_customer_confirmation','on_hold','escalation','resolved','closed'))
  `);
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "sla_paused_at" timestamp with time zone`,
  );

  console.log("✓ 'on_hold' status allowed + tickets.sla_paused_at present.");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
