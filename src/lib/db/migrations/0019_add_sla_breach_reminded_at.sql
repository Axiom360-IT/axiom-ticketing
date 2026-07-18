ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "sla_breach_reminded_at" timestamp with time zone;
