-- New permission `mcp.connect` gates whether a user can generate their own
-- Claude/MCP access token from their profile page. Grant it by default to
-- Super Admin, IT Director, and Coordinator only — mirrors the pattern in
-- migration 0015 (audit_view_default_grant): `pnpm db:seed` is a no-op once
-- roles exist, so an already-seeded database needs this backfill to pick up
-- a permission that didn't exist at the time it was first seeded.
--
-- Applied in production via `pnpm db:add-mcp-connect-permission` (idempotent
-- script), not `drizzle-kit migrate` — mirrors the convention established by
-- migrations 0019-0030.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, 'mcp.connect'
FROM "roles" r
WHERE r.name IN ('Super Admin', 'IT Director', 'Coordinator')
ON CONFLICT DO NOTHING;
