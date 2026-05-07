/**
 * Creates the initial Super Admin user via Better Auth's API and assigns the
 * Super Admin role.
 *
 * Run with:  pnpm db:seed-super-admin
 *
 * Reads INITIAL_SUPER_ADMIN_EMAIL, INITIAL_SUPER_ADMIN_NAME,
 *       INITIAL_SUPER_ADMIN_PASSWORD from .env.local.
 *
 * Idempotent: if a user with that email already exists, the script exits
 * without changes (does NOT update the password).
 */

import { eq } from "drizzle-orm";
import { auth } from "../auth/index";
import { db } from "./client";
import { users } from "./schema/auth";
import { roles, userRoles } from "./schema/rbac";

async function main() {
  const email = process.env.INITIAL_SUPER_ADMIN_EMAIL;
  const password = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  const name = process.env.INITIAL_SUPER_ADMIN_NAME ?? "Super Admin";

  if (!email || !password) {
    console.error(
      "Missing INITIAL_SUPER_ADMIN_EMAIL or INITIAL_SUPER_ADMIN_PASSWORD in .env.local",
    );
    process.exit(1);
  }

  // Skip if already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    console.log(`User ${email} already exists; skipping.`);
    return;
  }

  // Create user via Better Auth (handles password hashing + accounts row)
  console.log(`Creating Super Admin: ${email}…`);
  const result = await auth.api.signUpEmail({
    body: { email, password, name },
  });

  if (!result.user) {
    console.error("Better Auth signUpEmail returned no user:", result);
    process.exit(1);
  }

  // Find the Super Admin role
  const sa = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, "Super Admin"))
    .limit(1);
  if (sa.length === 0) {
    console.error("Super Admin role not seeded. Run `pnpm db:seed` first.");
    process.exit(1);
  }

  // Assign the role
  await db.insert(userRoles).values({
    userId: result.user.id,
    roleId: sa[0].id,
    assignedById: null, // system-assigned at seed time
  });

  console.log(`✓ Super Admin created: ${result.user.id}`);
  console.log(`  Email: ${email}`);
  console.log(`  Login at: ${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/admin/login`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Seed Super Admin failed:", err);
    process.exit(1);
  });
