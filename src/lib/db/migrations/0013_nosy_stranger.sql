ALTER TABLE "work_logs" ADD COLUMN "technician_name" text;--> statement-breakpoint
-- Backfill the denormalized author-name snapshot for existing entries so a
-- technician who is later removed/merged-out stays attributable.
UPDATE "work_logs" w
SET "technician_name" = u."name"
FROM "users" u
WHERE w."technician_id" = u."id" AND w."technician_name" IS NULL;--> statement-breakpoint
-- Grant the new Superadmin-only tickets.merge permission to the seeded
-- Super Admin role so an already-seeded database picks it up on migrate
-- (db:seed is a no-op once roles exist). Idempotent via the
-- role_permissions (role_id, permission) primary key.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'tickets.merge'
FROM "roles" r
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Single-technician model (req 3.1): the general multi-technician
-- "collaborator" feature (Meeting-2 CR-11) is removed. ticket_assignees now
-- holds ONLY merge co-assignees, which are written exclusively by the merge
-- flow going forward. No merge co-assignees exist yet, so every pre-existing
-- row is a legacy collaborator — clear them so they aren't misread as a second
-- assigned technician.
DELETE FROM "ticket_assignees";
