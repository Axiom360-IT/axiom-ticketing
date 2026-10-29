import { sql } from "drizzle-orm";
import { auditActionCategory, auditSeverity } from "../audit/action-label";
import { ALL_PERMISSIONS } from "../auth/permissions";
import { RANK, TECHNICAL_LEAD_ROLE } from "../auth/rank";
import { db } from "./client";

/**
 * Creates the Technical Lead role and gives it to ONE existing account.
 *
 *   pnpm db:add-technical-lead                      → m.luqman@axiom360.it
 *   pnpm db:add-technical-lead someone@axiom360.it  → that account instead
 *
 * What it does:
 *   • creates the role at rank 2, flagged as a system role (so Roles cannot
 *     delete it), holding EVERY permission in the code
 *   • adds it to the named account, who KEEPS every role they already have
 *   • writes an audit entry, because this grants the highest privilege there is
 *
 * What it deliberately does NOT do: strip anything from Super Admin. That is a
 * separate, deliberate act, done through the Roles screen once the Technical
 * Lead is signed in and has seen that everything works.
 *
 * Idempotent, and the way to bring the role up to date: re-running re-syncs its
 * permissions to the full list, so after a release that adds a permission, run
 * this again and the Technical Lead gets it. Nothing else is touched.
 *
 * The Technical Lead role is immutable from inside the app — nothing outranks
 * rank 2 — so THIS SCRIPT is the only way it changes, on purpose.
 *
 * Needs `pnpm db:add-role-rank` and `pnpm db:add-technical-permissions` first.
 */
const DEFAULT_EMAIL = "m.luqman@axiom360.it";

async function main(): Promise<void> {
  const email = (process.argv[2] ?? DEFAULT_EMAIL).trim().toLowerCase();

  // ── preconditions, checked before anything is written ──
  const hasRank = (
    await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'roles' AND column_name = 'rank'
    `)
  ).rows;
  if (hasRank.length === 0) {
    throw new Error("roles.rank does not exist yet. Run `pnpm db:add-role-rank` first.");
  }

  const found = (
    await db.execute(sql`
      SELECT "id", "name", "email", "is_active" FROM "users"
      WHERE lower("email") = ${email} LIMIT 1
    `)
  ).rows as { id: string; name: string; email: string; is_active: boolean }[];
  const user = found[0];
  if (!user) throw new Error(`No account with the email ${email}.`);
  if (!user.is_active) throw new Error(`${email} is deactivated. Reactivate it first.`);

  // ── the role ──
  const created = (
    await db.execute(sql`
      INSERT INTO "roles" ("name", "description", "is_system", "rank")
      VALUES (
        ${TECHNICAL_LEAD_ROLE},
        'Complete access to every feature, setting and permission. Cannot be edited from inside the app.',
        true,
        ${RANK.TECHNICAL_LEAD}
      )
      ON CONFLICT ("name") DO UPDATE
        SET "rank" = ${RANK.TECHNICAL_LEAD}, "is_system" = true
      RETURNING "id", (xmax = 0) AS inserted
    `)
  ).rows as { id: string; inserted: boolean }[];
  const role = created[0];
  if (!role) throw new Error("Could not create or find the role.");

  // ── its permissions: exactly the full list, no more, no fewer ──
  await db.execute(sql`DELETE FROM "role_permissions" WHERE "role_id" = ${role.id}`);
  await db.execute(sql`
    INSERT INTO "role_permissions" ("role_id", "permission")
    VALUES ${sql.join(
      ALL_PERMISSIONS.map((p) => sql`(${role.id}, ${p})`),
      sql`, `,
    )}
  `);

  // ── the grant ──
  const granted = (
    await db.execute(sql`
      INSERT INTO "user_roles" ("user_id", "role_id")
      VALUES (${user.id}, ${role.id})
      ON CONFLICT DO NOTHING
      RETURNING "user_id"
    `)
  ).rows;
  const isNewGrant = granted.length > 0;

  // ── audit, only for a NEW grant (a re-run to sync permissions is not one) ──
  if (isNewGrant) {
    const action = "role.technical_lead_grant";
    await db.execute(sql`
      INSERT INTO "audit_log"
        ("action", "category", "severity", "outcome", "target_type", "target_id",
         "target_label", "after_value", "actor_role_snapshot")
      VALUES (
        ${action}, ${auditActionCategory(action)}, ${auditSeverity(action)}, 'success',
        'user', ${user.id}, ${user.name},
        ${JSON.stringify({ email: user.email, role: TECHNICAL_LEAD_ROLE, via: "script" })}::jsonb,
        'install script'
      )
    `);
  }

  const roles = (
    await db.execute(sql`
      SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${user.id} ORDER BY r.name
    `)
  ).rows as { name: string }[];

  console.log(
    `${created[0]?.inserted ? "created" : "updated"} role "${TECHNICAL_LEAD_ROLE}" (rank ${RANK.TECHNICAL_LEAD}, ${ALL_PERMISSIONS.length} permissions)`,
  );
  console.log(
    isNewGrant
      ? `✓ granted to ${user.email}`
      : `✓ ${user.email} already had it — permissions re-synced`,
  );
  console.log(`  ${user.email} now holds: ${roles.map((r) => r.name).join(", ")}`);
  console.log(
    "\nNothing was removed from anyone. When you are ready to restrict Super Admin,\n" +
      "sign in as the Technical Lead and edit that role from Roles.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
