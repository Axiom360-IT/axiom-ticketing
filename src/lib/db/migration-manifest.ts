// ── Which database migrations run on deploy ───────────────────────────
//
// Every `db:add-*` script in package.json belongs to exactly ONE of three
// lists below, and migration-manifest.test.ts fails if a new one belongs to
// none. That test is the point of this file: the failure it prevents is "added
// a migration, forgot to register it, and the deploy shipped code that reads a
// column nobody created".
//
//   DEPLOY_MIGRATIONS   run automatically, once, during a PRODUCTION build —
//                       BEFORE the new code receives any traffic
//   MANUAL_MIGRATIONS   never run by a deploy; a person runs them on purpose
//   LEGACY_MIGRATIONS   applied by hand before the runner existed; the runner
//                       never touches them
//
// RULES FOR AN AUTOMATIC MIGRATION — each is something the runner relies on:
//
//   1. ADDITIVE. Add a table, a column, a grant. Never drop, rename, truncate
//      or rewrite. The build runs while the PREVIOUS version is still serving,
//      so for a short while old code runs against the new schema. Additive
//      changes are the only kind where that is always fine, and it is also why
//      a failed build leaves the site safely on the old version.
//   2. IDEMPOTENT. Re-running must be harmless. Two production builds can
//      overlap and the HTTP database driver cannot hold a lock across
//      statements, so overlap is made safe by idempotency rather than prevented.
//   3. IMMUTABLE ONCE SHIPPED. The ledger records a migration by NAME. Edit a
//      shipped one and the change never reaches a database that already ran it.
//      To change what a migration did, write a new script.
//
// Never automatic, whatever the temptation: seeds, backfills, resets, and
// anything that grants privilege. See MANUAL_MIGRATIONS.

export type DeployMigration = {
  /** The file name without `.ts`; also the key in the `deploy_migrations`
   *  ledger, so it is never reused for different work (rule 3). */
  id: string;
  description: string;
  /**
   * Optional SELECT that returns a row if this migration is ALREADY fully in
   * place. Consulted only when the ledger has no record of it, to adopt a
   * migration that was applied by hand before the runner existed — recording it
   * rather than re-running it. Re-running is harmless (rule 2) but not free:
   * several of these re-add constraints and recreate triggers, which briefly
   * lock `tickets` and `messages` against live traffic, for no benefit.
   *
   * Written so that a missing column or table makes it throw rather than
   * return false; the runner treats SQLSTATE 42703/42P01 as "not in place".
   */
  appliedProbe?: string;
};

export const DEPLOY_MIGRATIONS: readonly DeployMigration[] = [
  {
    id: "add-automation-rules",
    description: "The rule engine: four tables and the change-capture triggers",
    appliedProbe: `
      SELECT 1 WHERE
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tickets_change_capture' AND NOT tgisinternal)
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_change_capture' AND NOT tgisinternal)
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'automation_rules' AND column_name = 'apply_to_existing')`,
  },
  {
    // Must precede add-technical-permissions? No dependency — but the session
    // loader and the role screens read `roles.rank`, so it must be in place
    // before the new code serves a request. Listed first for that reason.
    id: "add-role-rank",
    description: "roles.rank, and the Super Admin role ranked at 1",
    appliedProbe: `
      SELECT 1 WHERE
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'roles' AND column_name = 'rank')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_rank_check')
        AND EXISTS (SELECT 1 FROM roles WHERE name = 'Super Admin' AND "rank" >= 1)`,
  },
  {
    // One new table, nothing else. The ticket and user pages read it, but every
    // read is guarded so they cannot break if it is missing.
    id: "add-email-delivery-issues",
    description: "email_delivery_issues: addresses Resend will not deliver to",
    appliedProbe: `
      SELECT 1 WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_delivery_issues')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_delivery_issues_status_check')`,
  },
  {
    // Copies the new technical permissions onto every role that already holds
    // settings.*, so splitting the permission changes nobody's access. A
    // plain INSERT … ON CONFLICT DO NOTHING: no probe, no lock, and cheap
    // enough to simply run once.
    id: "add-technical-permissions",
    description: "settings.technical.* and rules.manage, granted to whoever holds settings.*",
  },
];

/** Run by a person, on purpose. Never by a deploy. */
export const MANUAL_MIGRATIONS: readonly { id: string; why: string }[] = [
  {
    id: "add-technical-lead",
    why:
      "Grants the highest privilege in the system to a named account. That must be a decision somebody makes, not a side effect of a push — and it needs the new code live first.",
  },
];

/** Applied by hand before the runner existed. Frozen: nothing is added here. */
export const LEGACY_MIGRATIONS: readonly string[] = [
  "add-unassigned-reminder-column",
  "add-sla-breach-reminded-column",
  "add-customer-followup-column",
  "add-invoice-number-column",
  "add-csat-reviews",
  "add-ticket-categories",
  "add-ticket-types",
  "add-invite-status-columns",
  "add-audit-filter-presets",
  "add-mcp-tokens",
  "add-mcp-connect-permission",
  "add-vendors",
  "add-ticket-type-icon-column",
  "add-invite-send-failed-column",
  "add-provisioned-at-column",
  "add-in-app-notification-column",
  "add-organization-internal-column",
  "add-on-hold-status",
  "add-ticket-created-by-column",
  "add-ticket-service-type-column",
  "add-hourly-billable-tiers",
  "add-followup-rule",
  "add-ticket-created-by-email",
  "add-participant-permission",
  "add-participant-pending",
  "add-automations",
  "add-email-template-overrides",
  "add-email-threading",
];
