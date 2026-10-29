import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Installs the three permissions that split what `settings.update` used to
 * mean, onto every role that ALREADY held it — so that introducing the split
 * changes nobody's access.
 *
 *   settings.technical.view    → every role holding settings.view
 *   settings.technical.update  → every role holding settings.update
 *   rules.manage               → every role holding settings.update
 *
 * Idempotent. Run via `pnpm db:add-technical-permissions`, BEFORE deploying the
 * code that checks them: until it has run, the Settings page and the Automations
 * rules section would disappear for everyone who can see them today.
 *
 * Needed at all because `pnpm db:seed` no-ops once any role exists, so a
 * permission added to the code lands in ZERO role_permissions rows on a live
 * database. Same shape as add-participant-permission.ts.
 *
 * This is deliberately a COPY, not a restriction. The Technical Lead prunes it
 * afterwards, on purpose, from Roles. Nothing here takes anything away.
 */
const GRANTS: { permission: string; from: string }[] = [
  { permission: "settings.technical.view", from: "settings.view" },
  { permission: "settings.technical.update", from: "settings.update" },
  { permission: "rules.manage", from: "settings.update" },
];

async function main(): Promise<void> {
  for (const g of GRANTS) {
    await db.execute(sql`
      INSERT INTO role_permissions (role_id, permission)
      SELECT rp.role_id, ${g.permission}
      FROM role_permissions rp
      WHERE rp.permission = ${g.from}
      ON CONFLICT DO NOTHING
    `);
  }

  const rows = (
    await db.execute(sql`
      SELECT rp.permission, string_agg(r.name, ', ' ORDER BY r.name) AS roles
      FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
      WHERE rp.permission IN ('settings.view','settings.update',
        'settings.technical.view','settings.technical.update','rules.manage')
      GROUP BY rp.permission ORDER BY rp.permission
    `)
  ).rows as { permission: string; roles: string }[];

  console.log("who holds what now:");
  for (const r of rows) console.log(`  ${r.permission.padEnd(28)} ${r.roles}`);
  console.log(
    "\n✓ nobody gained or lost access. To tighten it, remove the technical\n" +
      "  permissions from the roles that should not have them (Roles → edit).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
