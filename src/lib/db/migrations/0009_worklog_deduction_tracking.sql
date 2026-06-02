ALTER TABLE "tickets" ADD COLUMN "monthly_plan_deducted_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Meeting-2 CR-10: technicians can reassign their own ticket to a colleague.
-- Grant the existing Technician role tickets.assign (scoped to their own
-- tickets by the can() gate). Idempotent via the role_permissions PK.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'tickets.assign'
FROM "roles" r
WHERE r.name = 'Technician'
ON CONFLICT DO NOTHING;