// Closed set of permission strings for the Axiom Ticketing System.
// This is the source of truth for the `Permission` type used by `can()`.
// Permissions live in code (this file) — `role_permissions.permission` rows
// in the DB must match a constant here. Code review enforces.

export const PERMISSIONS = [
  // Tickets
  "tickets.view",
  "tickets.create",
  "tickets.update",
  "tickets.assign",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.resolve",
  // PRD §5.6 / Spec §8.2 — Coordinator override that lets the user resolve
  // a ticket WITHOUT a resolution note in genuine edge cases (duplicate,
  // customer cancelled). The audit log captures the reason.
  "tickets.resolve_skip_note",
  "tickets.reopen",
  "tickets.escalate",
  "tickets.deescalate",
  "tickets.delete",
  // Superadmin-only: merge a duplicate ticket into another. Distinct from
  // tickets.delete so a custom role granted delete can't merge (req §4).
  "tickets.merge",
  "tickets.export",

  // Procurement (Meeting-2 CR-24: approval removed; coordinator actions the
  // request through the 4 stages via procurement.manage)
  "procurement.view",
  "procurement.create",
  "procurement.update",
  "procurement.manage",
  "procurement.export",

  // Reports
  "reports.view",
  "reports.export",

  // Work log (Meeting-2 follow-up): every technician can view/manage their
  // OWN time entries on the timesheet page; this permission additionally
  // unlocks seeing EVERYONE's entries (granted to Super Admin by default).
  "worklog.view_all",

  // Organizations (Meeting-2, CR-06)
  "organizations.view",
  "organizations.create",
  "organizations.update",
  "organizations.delete",

  // Users
  "users.view",
  "users.create",
  "users.update",
  "users.deactivate",
  "users.reactivate",
  "users.reset_password",
  "users.impersonate",
  "users.unlock",

  // Roles
  "roles.view",
  "roles.create",
  "roles.update",
  "roles.delete",

  // Settings
  "settings.view",
  "settings.update",

  // Audit Log
  "audit.view",
  "audit.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// All permissions — used for the Super Admin role.
export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

// ── Per-role permission sets (per PRD §5.11 seeded defaults) ──

export const IT_DIRECTOR_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.update",
  "tickets.assign",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.deescalate",
  "organizations.view",
  "reports.view",
  "audit.view",
];

export const COORDINATOR_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.create",
  "tickets.update",
  "tickets.assign",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.resolve",
  "tickets.resolve_skip_note",
  "tickets.reopen",
  "tickets.deescalate",
  "organizations.view",
  "organizations.create",
  "organizations.update",
  "procurement.view",
  "procurement.manage",
  "users.view",
  "reports.view",
  // Req 7.2 — audit logs are visible to everyone by default. An admin can
  // revoke this from a role to hide the logs view from it.
  "audit.view",
];

export const TECHNICIAN_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.update",
  "tickets.assign",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.resolve",
  "tickets.escalate",
  "procurement.view",
  "procurement.create",
  "procurement.update",
  // Req 7.2 — audit logs are visible to everyone by default. A normal
  // technician with this permission sees ONLY their own actions (req 7.1,
  // scoped in src/app/actions/audit.ts); revoking it hides the logs view.
  "audit.view",
];

export const CUSTOMER_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.create",
  "tickets.reply",
  "procurement.view",
  "procurement.create",
];

