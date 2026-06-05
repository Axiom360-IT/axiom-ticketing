/**
 * Seed the REAL production data: the client organizations (+ domains) and the
 * staff users (with role assignments + a "set your password" invite email).
 * Idempotent — skips organizations/users that already exist.
 *
 * Run AFTER `pnpm db:reset-for-production --confirm`, with:
 *   pnpm db:seed-production --confirm
 *
 * Requires the system roles to exist (run `pnpm db:seed` first if needed) and
 * NEXT_PUBLIC_APP_URL set so the invite links point at the live app.
 *
 * Existing kept users (m.luqman, e.rueca) are NOT recreated; e.rueca's role is
 * reconciled to Coordinator. New users get an invite via Better Auth's
 * password-reset (staff_setup_invite) flow — if email send fails, they can use
 * "Forgot password" on the login page to set their password.
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { auth } from "../auth/index";
import { db, transactional } from "./client";
import { accounts, users } from "./schema/auth";
import {
  organizationDomains,
  organizations,
} from "./schema/organizations";
import { roles, userRoles } from "./schema/rbac";

// ── Client organizations (name → ticket code → email domains) ─────────
const ORGS: { name: string; code: string; domains: string[] }[] = [
  { name: "Acadian Group", code: "ACAD", domains: ["acadiangroup.ca"] },
  { name: "AXXIMA Actuarial & Insurance Management Advisors", code: "AXXI", domains: ["axxima.ca"] },
  { name: "Bramic Creative Business Products Ltd.", code: "BRAM", domains: ["bramic.net"] },
  { name: "CMEPP Canadian Medical Equipment Protection Plan", code: "CMEPP", domains: ["cmepp.com"] },
  { name: "Croven Crystals", code: "CROV", domains: ["crovencrystals.com", "quanticcroven.com"] },
  { name: "Edac Inc.", code: "EDAC", domains: ["edacgroup.net", "edac.net"] },
  { name: "G. Brandt Meat Packers Ltd.", code: "BRAN", domains: ["brandtmeats.com"] },
  { name: "Golf Canada", code: "GOLF", domains: ["golfcanada.ca"] },
  { name: "Indigo Natural Foods Inc.", code: "INDI", domains: ["indigofoodsinc.com"] },
  { name: "IsoAcoustics Inc", code: "ISO", domains: ["isoacoustics.com"] },
  { name: "Kendrew", code: "KEND", domains: ["kendrew.ca"] },
  { name: "Kingsmill Foods Company", code: "KING", domains: ["kingsmillfoods.com"] },
  { name: "Merry Electronics North America Inc.", code: "MERR", domains: ["merryelectronics.ca"] },
  { name: "Molisana Imports", code: "MOLI", domains: ["molisana.com"] },
  { name: "Precision Woodcraft", code: "PREC", domains: ["precisionwoodcnc.ca"] },
  { name: "Printer's Parts & Equipment", code: "PRIN", domains: ["printersparts.com"] },
  { name: "Reich & Petch", code: "RP", domains: ["designrp.com"] },
  { name: "RIDGE CANADA", code: "RIDG", domains: ["ridgecanada.com"] },
  { name: "Sherbourne Health", code: "SHER", domains: ["sherbourne.on.ca"] },
  { name: "Super Seal Mfg. Ltd.", code: "SSM", domains: ["supersealmfg.com"] },
  { name: "United Staffing Services", code: "USS", domains: ["unitedstaffing.ca"] },
  { name: "Vital Link Ice-Cream & Events Marketing", code: "VITA", domains: ["vitalinkevents.com"] },
  { name: "Yorkville Asset Management Inc.", code: "YAM", domains: ["yorkvilleasset.com", "yamfs.ca"] },
  { name: "Your Electric Bill Analyzed For You", code: "YEBA", domains: ["yebafy.com"] },
];

// ── New staff users (e.rueca + m.luqman already exist and are kept) ───
const NEW_USERS: {
  name: string;
  email: string;
  phone: string | null;
  role: string;
}[] = [
  { name: "Naylan Corridon", email: "n.corridon@axiom360.it", phone: "+14168736231", role: "Super Admin" },
  { name: "Junaid Ahmed", email: "j.ahmed@axiom360.it", phone: "+16478321987", role: "Super Admin" },
  // "IT Manager" in the source list → mapped to the IT Director system role.
  { name: "Adnan Javaid", email: "a.javaid@axiom360.it", phone: null, role: "IT Director" },
  { name: "Moyeed Ahmed", email: "m.ahmed@axiom360.it", phone: "+14168231684", role: "Technician" },
  { name: "Kanwardeep Singh", email: "k.singh@axiom360.it", phone: "+16479752335", role: "Technician" },
  { name: "Hannibal Manna", email: "h.manna@axiom360.it", phone: "+16476969417", role: "Technician" },
  { name: "Mohamed Lamei", email: "m.lamei@axiom360.it", phone: "+971582331731", role: "Technician" },
];

// Kept users whose role(s) we re-assert (they're not recreated).
const RECONCILE: { email: string; roles: string[] }[] = [
  { email: "e.rueca@axiom360.it", roles: ["Coordinator", "Super Admin"] },
];

async function main() {
  const confirmed =
    process.argv.includes("--confirm") || process.env.CONFIRM === "yes";
  if (!confirmed) {
    console.error(
      [
        "Refusing to run without confirmation.",
        "",
        `Seeds ${ORGS.length} organizations and ${NEW_USERS.length} staff users`,
        "(sending each new user a set-your-password invite email).",
        "",
        "Re-run with --confirm:",
        "  pnpm db:seed-production --confirm",
      ].join("\n"),
    );
    process.exit(1);
  }

  // Resolve role ids by name; abort if the system roles are missing.
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles);
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]));
  const required = ["Super Admin", "IT Director", "Coordinator", "Technician"];
  const missingRoles = required.filter((r) => !roleId.has(r));
  if (missingRoles.length > 0) {
    console.error(
      `ABORT — missing system role(s): ${missingRoles.join(", ")}.\n` +
        "Run `pnpm db:seed` first.",
    );
    process.exit(1);
  }

  // ── 1. Organizations + domains (idempotent). ──────────────────────
  let orgsNew = 0;
  let domainsNew = 0;
  for (const o of ORGS) {
    const inserted = await db
      .insert(organizations)
      .values({
        name: o.name,
        abbreviation: o.code,
        isMonthlyPlan: false,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning({ id: organizations.id });

    let orgId = inserted[0]?.id;
    if (orgId) {
      orgsNew++;
    } else {
      const [existing] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.name, o.name))
        .limit(1);
      orgId = existing?.id;
    }
    if (!orgId) {
      console.warn(`  org skipped (name/code conflict): ${o.name}`);
      continue;
    }
    for (const domain of o.domains) {
      const d = await db
        .insert(organizationDomains)
        .values({ organizationId: orgId, domain })
        .onConflictDoNothing()
        .returning({ id: organizationDomains.id });
      if (d.length > 0) domainsNew++;
    }
  }
  console.log(
    `Organizations: +${orgsNew} new (${ORGS.length} in list), domains +${domainsNew}`,
  );

  // ── 2. Reconcile kept users' roles (e.rueca → Coordinator). ───────
  for (const rc of RECONCILE) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${rc.email.toLowerCase()}`)
      .limit(1);
    if (!u) {
      console.warn(`  reconcile skipped — ${rc.email} not found`);
      continue;
    }
    const rids = rc.roles
      .map((r) => roleId.get(r))
      .filter((x): x is string => Boolean(x));
    if (rids.length === 0) continue;
    await transactional(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, u.id));
      await tx
        .insert(userRoles)
        .values(rids.map((rid) => ({ userId: u.id, roleId: rid })));
    });
    console.log(`  reconciled ${rc.email} → ${rc.roles.join(", ")}`);
  }

  // ── 3. New staff users + set-your-password invite. ────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!appUrl) {
    console.warn(
      "  NOTE: NEXT_PUBLIC_APP_URL is not set — invite links may be wrong.",
    );
  }
  let created = 0;
  let invited = 0;
  for (const u of NEW_USERS) {
    const email = u.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existing) {
      console.log(`  user exists, skipped: ${email}`);
      continue;
    }
    const rid = roleId.get(u.role);
    if (!rid) {
      console.warn(`  no role id for ${u.role}; skipping ${email}`);
      continue;
    }

    // Mirror the admin createUser flow: user + null-password credential
    // account + role, then a password-reset (= setup invite) email.
    const id = randomUUID();
    await transactional(async (tx) => {
      await tx.insert(users).values({
        id,
        email,
        emailVerified: true,
        name: u.name,
        phone: u.phone,
        organizationId: null,
        isActive: true,
      });
      await tx.insert(accounts).values({
        userId: id,
        accountId: id,
        providerId: "credential",
        password: null,
      });
      await tx.insert(userRoles).values({ userId: id, roleId: rid });
    });
    created++;

    try {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: `${appUrl}/admin/login?reset=ok` },
      });
      invited++;
      console.log(`  created + invited: ${email} (${u.role})`);
    } catch (err) {
      console.warn(
        `  created ${email} (${u.role}) but invite email FAILED:`,
        err instanceof Error ? err.message : err,
      );
    }
    // Gentle pacing so a burst of resets doesn't trip a rate limit.
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`Users: +${created} created, ${invited} invite email(s) sent.`);
  console.log("");
  console.log(
    "Seed complete. Any user not emailed can set their password via",
    "“Forgot password” on the admin login page.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:");
  console.error(err);
  process.exit(1);
});
