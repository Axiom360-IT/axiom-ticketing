import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * One-shot, idempotent: apply the agreed "Awaiting customer" follow-up rule.
 *
 *   reminder on day 1, 2 and 3 → silence on day 4 → auto-close on day 5
 *
 * Two parts:
 *  1. `tickets.customer_followup_count` — how many reminders have gone out for
 *     the current agent message, so the series can stop at max_reminders and
 *     leave the deliberate quiet day(s) before the close.
 *  2. The four settings the monitor reads. These are UPSERTED to the agreed
 *     values (close_days was 5 live, and followup_days / max_reminders / daily
 *     had no row at all, so the code fallbacks were silently in charge).
 *     Re-running re-asserts the rule.
 *
 * Run via `pnpm db:add-followup-rule`.
 */
const SETTINGS: { key: string; value: unknown; description: string }[] = [
  {
    key: "customer_followup.enabled",
    value: true,
    description:
      "Send follow-up emails and auto-close tickets awaiting a customer reply that goes unanswered",
  },
  {
    key: "customer_followup.daily",
    value: true,
    description: "Send the follow-up reminder once per day (up to the maximum)",
  },
  {
    key: "customer_followup.followup_days",
    value: 1,
    description:
      "Days a ticket may await the customer's reply before the FIRST reminder is sent",
  },
  {
    key: "customer_followup.max_reminders",
    value: 3,
    description:
      "How many daily reminders go out before the ticket falls silent for the rest of the window",
  },
  {
    key: "customer_followup.close_days",
    value: 4,
    description:
      "Days after the FIRST reminder, with still no reply, before the ticket auto-closes",
  },
];

async function main(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "customer_followup_count" integer NOT NULL DEFAULT 0`,
  );
  console.log("✓ tickets.customer_followup_count present");

  for (const s of SETTINGS) {
    const before = await db.execute(
      sql`SELECT value FROM settings WHERE key = ${s.key}`,
    );
    const prev = (before.rows as { value?: unknown }[])[0]?.value;
    await db.execute(sql`
      INSERT INTO settings (key, value, description, updated_at)
      VALUES (${s.key}, ${JSON.stringify(s.value)}::jsonb, ${s.description}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = excluded.value,
            description = excluded.description,
            updated_at = now()
    `);
    const was = prev === undefined ? "(unset)" : JSON.stringify(prev);
    console.log(`✓ ${s.key}: ${was} → ${JSON.stringify(s.value)}`);
  }

  console.log(
    "\n✓ Rule applied: reminders on days 1, 2 and 3 → quiet on day 4 → auto-closed on day 5.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
