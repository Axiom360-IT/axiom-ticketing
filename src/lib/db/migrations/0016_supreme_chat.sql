-- IF NOT EXISTS so this migration is safe to re-run if a prior attempt
-- applied the columns but failed on a later statement (the neon-http driver
-- auto-commits per statement, so a mid-migration failure isn't rolled back).
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "monthly_plan_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "negative_balance_alerted_at" timestamp with time zone;--> statement-breakpoint
-- Mark existing monthly-plan orgs as already reset for the CURRENT month so the
-- daily reset cron (req 8.2) does NOT wipe their consumed balance back to the
-- included hours mid-month on its first run. They will next reset on the 1st.
-- `date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'` is the
-- UTC-pinned start of the current month as a timestamptz, and works on every
-- Postgres version (the 3-arg date_trunc is Postgres 14+ only).
UPDATE "organizations"
SET "monthly_plan_reset_at" = date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
WHERE "is_monthly_plan" = true AND "monthly_plan_reset_at" IS NULL;--> statement-breakpoint
-- Seed the accountant-notification settings (reqs 8.6–8.9) on already-seeded
-- databases (db:seed is a no-op once roles exist). Idempotent via the settings
-- primary key on (key).
INSERT INTO "settings" ("key", "value", "description")
VALUES
  ('billing.accountant_emails', '[]'::jsonb, 'Accountant email addresses that receive negative-balance and ticket-billing notifications'),
  ('billing.accountant_phones', '[]'::jsonb, 'Accountant phone numbers (E.164) that receive the negative-balance SMS'),
  ('billing.superadmin_receive_copy', 'false'::jsonb, 'Also send accountant billing notifications to active Super Admins')
ON CONFLICT ("key") DO NOTHING;