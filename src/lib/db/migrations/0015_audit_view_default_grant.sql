-- Req 7.2 — audit logs are visible to everyone by default. Grant the
-- "Audit Logs" permission (audit.view) to the seeded Technician and
-- Coordinator roles so an already-seeded database picks it up on migrate
-- (db:seed is a no-op once roles exist). Super Admin and IT Director already
-- hold audit.view. A strict Technician with this permission sees ONLY their
-- own actions (req 7.1, enforced in src/app/actions/audit.ts); revoking the
-- permission from a role hides the logs view from it entirely.
-- Idempotent via the role_permissions (role_id, permission) primary key.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'audit.view'
FROM "roles" r
WHERE r.name IN ('Technician', 'Coordinator')
ON CONFLICT DO NOTHING;
