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
  "tickets.reopen",
  "tickets.escalate",
  "tickets.deescalate",
  "tickets.delete",
  "tickets.export",

  // Procurement
  "procurement.view",
  "procurement.create",
  "procurement.update",
  "procurement.approve",
  "procurement.reject",
  "procurement.mark_purchased",
  "procurement.mark_delivered",
  "procurement.export",

  // Reports
  "reports.view",
  "reports.export",

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
  "tickets.reopen",
  "tickets.deescalate",
  "procurement.view",
  "procurement.approve",
  "procurement.reject",
  "procurement.mark_purchased",
  "procurement.mark_delivered",
  "users.view",
  "reports.view",
];

export const TECHNICIAN_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.update",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.resolve",
  "tickets.escalate",
  "procurement.view",
  "procurement.create",
  "procurement.update",
];

export const CUSTOMER_PERMISSIONS: Permission[] = [
  "tickets.view",
  "tickets.create",
  "tickets.reply",
  "procurement.view",
  "procurement.create",
];

// Privileged permissions — holding any of these mandates 2FA enrolment (per PRD §5.13).
export const PRIVILEGED_PERMISSIONS: Permission[] = [
  "users.create",
  "users.impersonate",
  "users.unlock",
  "roles.create",
  "roles.update",
  "roles.delete",
];
