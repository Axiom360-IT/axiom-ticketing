/**
 * DESTRUCTIVE reset — wipes all transactional + people data, keeping ONLY
 * the Super Admin account, the 5 system roles, and the settings.
 *
 * Run with:
 *   DATABASE_URL=<prod-url> pnpm db:reset-keep-superadmin --confirm
 *
 * KEEPS (untouched):
 *   - the 5 system roles + their permissions (is_system = true)
 *   - settings + holidays  → operations / email / SLA / security config
 *   - the Super Admin user (default m.luqman@axiom360.it) + its account row
 *
 * WIPES:
 *   - tickets, messages, attachments, procurement_requests
 *   - notifications, notification_preferences, failed_notifications
 *   - audit_log, verifications, passkeys, sessions, processed_webhook_events
 *   - every user EXCEPT the Super Admin (their accounts go too)
 *   - all custom (non-system) roles
 *   - all role assignments, THEN re-assigns ONLY Super Admin → kept user
 *   - resets ax_ticket_seq so the next ticket is AX-0001
 *
 * Why it re-assigns the role: `user_roles` may be empty (it was, when this
 * was written — the whole RBAC layer was effectively off). The reset
 * guarantees the kept user actually holds the Super Admin role afterward,
 * so they can sign in and rebuild from the admin panel.
 *
 * Safety: refuses to run without `--confirm`. Aborts (zero changes) if the
 * Super Admin email doesn't match a user, or the Super Admin role is
 * missing.
 *
 * Note: R2 attachment objects are NOT deleted — only DB rows. Orphaned R2
 * objects are harmless; clear the bucket manually for a pristine slate.
 */

import { eq, sql } from "drizzle-orm";
import { db, transactional } from "./client";
import { users } from "./schema/auth";
import { roles } from "./schema/rbac";

const KEEP_EMAIL = (process.env.RESET_KEEP_EMAIL ?? "m.luqman@axiom360.it")
  .trim()
  .toLowerCase();

const SUPER_ADMIN_ROLE = "Super Admin";

// Tables emptied wholesale. CASCADE clears FK dependents.
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
        "This permanently DELETES every ticket, message, attachment,",
        "procurement request, notification, audit-log entry, custom role,",
        `and every user account EXCEPT ${KEEP_EMAIL}.`,
        "",
        "Re-run with --confirm to proceed:",
        "  DATABASE_URL=<prod-url> pnpm db:reset-keep-superadmin --confirm",
      ].join("\n"),
    );
    process.exit(1);
  }

  // ── Pre-flight. Resolve the kept user + the Super Admin role. If
  // either is missing we abort here — nothing is deleted.
  const [keepUser] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${KEEP_EMAIL}`)
    .limit(1);

  if (!keepUser) {
    console.error(
      `ABORT — no user found with email "${KEEP_EMAIL}".\n` +
        "Nothing was changed. Override with the RESET_KEEP_EMAIL env var.",
    );
    process.exit(1);
  }

  const [saRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, SUPER_ADMIN_ROLE))
    .limit(1);

  if (!saRole) {
    console.error(
      `ABORT — the "${SUPER_ADMIN_ROLE}" role is missing.\n` +
        "Nothing was changed. Run pnpm db:seed to restore the system roles.",
    );
    process.exit(1);
  }

  console.log(`Keeping user:  ${keepUser.email} (${keepUser.id})`);
  console.log(`Super Admin role: ${saRole.id}`);

  // ── Destructive section, atomic.
  await transactional(async (tx) => {
    // 1. Empty every transactional table.
    await tx.execute(
      sql.raw(`TRUNCATE TABLE ${WIPE_TABLES.join(", ")} CASCADE`),
    );

    // 2. Clear all role assignments (`user_roles.role_id` is ON DELETE
    //    RESTRICT, so this must precede deleting any role).
    await tx.execute(sql`DELETE FROM user_roles`);

    // 3. Drop custom (non-system) roles. role_permissions cascade.
    await tx.execute(sql`DELETE FROM roles WHERE is_system = false`);

    // 4. Delete every user but the kept one. accounts cascade.
    await tx.execute(sql`DELETE FROM users WHERE id <> ${keepUser.id}`);

    // 5. Re-assign the Super Admin role to the kept user so they can
    //    actually sign in to the admin panel afterward.
    await tx.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${keepUser.id}, ${saRole.id})
      ON CONFLICT (user_id, role_id) DO NOTHING
    `);

    // 6. Reset the ticket-number counter so the next ticket is AX-0001.
    await tx.execute(sql`ALTER SEQUENCE ax_ticket_seq RESTART WITH 1`);
  });

  // ── Report.
  const [{ count: userCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  const [{ count: roleCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles);

  console.log("");
  console.log("Reset complete.");
  console.log(`  users remaining:  ${userCount} (expected 1)`);
  console.log(`  roles remaining:  ${roleCount} (expected 5 — system roles)`);
  console.log("  Super Admin role assigned to the kept user.");
  console.log("  tickets / messages / attachments: 0");
  console.log("  next ticket number: AX-0001");
  console.log("");
  console.log(
    "Settings + holidays were kept. Sign in again with the existing",
    "Super Admin password (all sessions were cleared).",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed — transaction rolled back, no changes made:");
  console.error(err);
  process.exit(1);
});
