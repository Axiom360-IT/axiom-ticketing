-- Robust inbound email threading + a finer-grained ticket creation source.
--
-- 1) `ticket_email_refs` maps an RFC Message-ID → ticket so a reply that
--    carries no ticket-number token (a customer replying inside their own
--    original thread, or to a staff Outlook reply) still lands on the right
--    ticket instead of opening a duplicate.
-- 2) `tickets.created_via` records HOW a ticket was created beyond the coarse
--    `origin` (direct vs forwarded email, manual staff entry, portal, form).
--
-- Apply idempotently via `pnpm db:add-email-threading`.

CREATE TABLE IF NOT EXISTS "ticket_email_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
  "rfc_message_id" text NOT NULL UNIQUE,
  "direction" text NOT NULL DEFAULT 'inbound',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_email_refs_ticket_id_idx" ON "ticket_email_refs" ("ticket_id");--> statement-breakpoint

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_via" text;
