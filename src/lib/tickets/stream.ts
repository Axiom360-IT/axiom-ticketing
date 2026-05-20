import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { getSetting } from "@/lib/settings";

// Single source of truth for "is this ticket internal or external?".
//
// Rule: role beats domain.
//   1. If the requester's email maps to a user account holding ANY
//      staff role (Super Admin / IT Director / Coordinator / Technician),
//      the ticket is internal — that user is a member of the IT team
//      regardless of what comes after the `@`.
//   2. Otherwise fall back to the `internal_email_domains` setting,
//      which is the only signal we have for anonymous public submissions
//      and inbound emails from senders without an account.
//
// This avoids the failure mode where a Technician with a personal
// gmail address has their tickets misclassified as external.

const STAFF_ROLE_NAMES = new Set([
  "Super Admin",
  "IT Director",
  "Coordinator",
  "Technician",
]);

export type Stream = "internal" | "external";

export async function classifyStream(email: string): Promise<Stream> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "external";

  // Look the email up against the users table; collect every role
  // assigned to a matching active user. A single staff-role hit is
  // enough to mark the ticket internal.
  const matchedRoles = await db
    .select({ name: roles.name, isActive: users.isActive })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(users.email, normalized));
  for (const row of matchedRoles) {
    if (row.isActive && STAFF_ROLE_NAMES.has(row.name)) {
      return "internal";
    }
  }

  // Fall back to the domain allowlist for anonymous / customer requests.
  const domains =
    (await getSetting<string[]>("internal_email_domains")) ?? [];
  const emailDomain = normalized.split("@")[1] ?? "";
  return domains.map((d) => d.toLowerCase()).includes(emailDomain)
    ? "internal"
    : "external";
}
