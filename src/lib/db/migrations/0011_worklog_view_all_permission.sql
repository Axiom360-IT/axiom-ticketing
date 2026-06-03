-- Grant the new worklog.view_all permission to the seeded Super Admin role so
-- an already-seeded database picks it up on migrate (db:seed is a no-op once
-- roles exist). Every technician manages their OWN time entries without this
-- permission; worklog.view_all additionally unlocks seeing EVERYONE's entries
-- on the timesheet page. Idempotent via the role_permissions
-- (role_id, permission) primary key.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'worklog.view_all'
FROM "roles" r
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;
