import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";
import { getSetting } from "@/lib/settings";

// Who receives accountant billing notifications (reqs 8.6–8.9). Accountants are
// OUR platform's accountants — a GLOBAL list of contacts configured in
// Settings, not per-organization. The Superadmin can opt in to receive a copy
// on their own account email/phone (req 8.8).

export type AccountantRecipients = { emails: string[]; phones: string[] };

export async function getAccountantRecipients(): Promise<AccountantRecipients> {
  const [emails, phones, superCopy] = await Promise.all([
    getSetting<string[]>("billing.accountant_emails"),
    getSetting<string[]>("billing.accountant_phones"),
    getSetting<boolean>("billing.superadmin_receive_copy"),
  ]);

  const emailSet = new Set<string>(
    (emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  const phoneSet = new Set<string>(
    (phones ?? []).map((p) => p.trim()).filter(Boolean),
  );

  if (superCopy) {
    const superAdmins = await db
      .select({ email: users.email, phone: users.phone })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.name, "Super Admin"), eq(users.isActive, true)));
    for (const u of superAdmins) {
      if (u.email) emailSet.add(u.email.trim().toLowerCase());
      if (u.phone) phoneSet.add(u.phone.trim());
    }
  }

  return { emails: [...emailSet], phones: [...phoneSet] };
}
