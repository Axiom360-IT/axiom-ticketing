/**
 * DESTRUCTIVE production reset — wipes ALL transactional, people, and
 * organization data, keeping ONLY the system roles, the settings/holidays
 * config, and a small set of kept users (with their existing roles intact).
 *
 * Run with:
 *   pnpm db:reset-for-production --confirm
 *
 * KEEPS (untouched):
 *   - the 5 system roles + their permissions (is_system = true)
 *   - settings + holidays  → operations / email / SLA / security / billing
 *   - the kept users (default: m.luqman@axiom360.it, e.rueca@axiom360.it).
 *     Their role assignments are reset to just Super Admin so they can sign in
 *     immediately; finalize roles via `pnpm db:seed-production`.
 *
 * WIPES:
 *   - tickets, messages, work_logs, attachments, procurement_requests
 *   - notifications, notification_preferences, failed_notifications
 *   - audit_log, verifications, passkeys, sessions, processed_webhook_events
 *   - ALL organizations, organization_domains, organization_trusted_emails
 *   - ticket_participants, ticket_assignees (cascade from tickets)
 *   - every user EXCEPT the kept ones (their accounts go too)
 *   - all custom (non-system) roles
 *   - resets ax_ticket_seq so the legacy counter starts fresh
 *
 * Override the kept set with RESET_KEEP_EMAILS (comma-separated).
 *
 * Safety: refuses to run without `--confirm`. Aborts (zero changes) if the
 * kept set is empty or ANY kept email doesn't match a user. R2 attachment
 * objects are NOT deleted — clear the bucket manually for a pristine slate.
 */

import { eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, transactional } from "./client";
import { users } from "./schema/auth";
import { organizations } from "./schema/organizations";
import { roles, userRoles } from "./schema/rbac";

const KEEP_EMAILS = (
  process.env.RESET_KEEP_EMAILS ??
  "m.luqman@axiom360.it,e.rueca@axiom360.it"
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Emptied wholesale via TRUNCATE … CASCADE. Truncating `tickets` cascades to
// its children (work_logs, ticket_assignees, ticket_participants). The
// organization tables are parents of tickets, so they're deleted separately.
const WIPE_TABLES = [
  "tickets",
  "messages",
  "attachments",
  "procurement_requests",
  "notifications",
  "notification_preferences",
  "failed_notifications",
  "audit_log",
  "verifications",
  "passkeys",
  "sessions",
  "processed_webhook_events",
] as const;

async function main() {
  const confirmed =
    process.argv.includes("--confirm") || process.env.CONFIRM === "yes";
  if (!confirmed) {
    console.error(
      [
        "Refusing to run without confirmation.",
        "",
        "This permanently DELETES every ticket, message, work-log, attachment,",
        "procurement request, notification, audit entry, ALL organizations, all",
        "custom roles, and every user account EXCEPT:",
        `  ${KEEP_EMAILS.join(", ")}`,
        "",
        "Re-run with --confirm to proceed:",
        "  pnpm db:reset-for-production --confirm",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (KEEP_EMAILS.length === 0) {
    console.error(
      "ABORT — RESET_KEEP_EMAILS is empty. Refusing to delete every user.",
    );
    process.exit(1);
  }

  // ── Pre-flight: resolve the kept users. Abort if any are missing —
  //    nothing is deleted.
  const keepRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(sql`lower(${users.email})`, KEEP_EMAILS));

  const foundEmails = new Set(keepRows.map((r) => r.email.toLowerCase()));
  const missing = KEEP_EMAILS.filter((e) => !foundEmails.has(e));
  if (missing.length > 0) {
    console.error(
      `ABORT — these kept email(s) don't match any user: ${missing.join(", ")}.\n` +
        "Nothing was changed. Fix RESET_KEEP_EMAILS or create the user(s) first.",
    );
    process.exit(1);
  }
  const keepIds = keepRows.map((r) => r.id);
  console.log(`Keeping ${keepRows.length} user(s):`);
  for (const r of keepRows) console.log(`  - ${r.email} (${r.id})`);

  // The kept users are re-assigned Super Admin so they're never locked out
  // after the wipe (the seed sets their final roles).
  const [sa] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, "Super Admin"))
    .limit(1);
  if (!sa) {
    console.error(
      'ABORT — the "Super Admin" role is missing. Run `pnpm db:seed` first.',
    );
    process.exit(1);
  }

  // ── Destructive section, atomic.
  await transactional(async (tx) => {
    // 1. Empty every transactional table (cascades clear ticket children).
    await tx.execute(
      sql.raw(`TRUNCATE TABLE ${WIPE_TABLES.join(", ")} CASCADE`),
    );

    // 2. Drop the org→user link, then delete every organization (domains +
    //    trusted_emails cascade).
    await tx.update(users).set({ organizationId: null });
    await tx.delete(organizations);

    // 3. Clear ALL role assignments — including any held by kept users — so a
    //    custom role they were on can be dropped without an FK violation
    //    (user_roles.role_id is ON DELETE RESTRICT).
    await tx.delete(userRoles);

    // 4. Drop custom (non-system) roles. role_permissions cascade.
    await tx.delete(roles).where(eq(roles.isSystem, false));

    // 5. Delete every user but the kept ones (accounts cascade).
    await tx.delete(users).where(notInArray(users.id, keepIds));

    // 6. Re-assign Super Admin to each kept user so they can sign in.
    await tx
      .insert(userRoles)
      .values(keepIds.map((id) => ({ userId: id, roleId: sa.id })));

    // 7. Reset the legacy ticket-number counter.
    await tx.execute(sql`ALTER SEQUENCE ax_ticket_seq RESTART WITH 1`);
  });

  // ── Report.
  const [{ count: userCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);

  console.log("");
  console.log("Reset complete.");
  console.log(`  users remaining:  ${userCount} (expected ${keepIds.length})`);
  console.log("  organizations:    0");
  console.log("  tickets / messages / work-logs: 0");
  console.log("  system roles + settings + holidays: kept");
  console.log("");
  console.log("Next: pnpm db:seed-production --confirm");
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed — transaction rolled back, no changes made:");
  console.error(err);
  process.exit(1);
});
