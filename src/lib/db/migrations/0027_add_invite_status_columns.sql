-- Invite lifecycle tracking for users (staff welcome-email AND customer
-- bulk-import invites). Status is derived at read time from these three
-- timestamps rather than stored as an enum — see schema/auth.ts.
--
-- Applied in production via `pnpm db:add-invite-status-columns` (idempotent
-- script), not `drizzle-kit migrate` — this file mirrors that script for a
-- readable schema history, matching the convention already established by
-- migrations 0018-0026.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_accepted_at" timestamp with time zone;
