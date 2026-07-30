"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema/auth";
import { verifyCustomerInviteToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";

// Backs the /portal/setup form — the customer-bulk-import counterpart of
// /admin/setup. Deliberately does NOT reuse Better Auth's
// `auth.api.resetPassword`: that verifies against Better Auth's own
// verification-token table, whose TTL is a single app-wide config value
// (see lib/auth/index.ts). Customer invites need an independently
// admin-configurable expiry, so they carry their own HMAC token (proves
// "this is really user X's invite link") checked against the live
// `users.invite_expires_at` column (the actual expiry gate) — then hash
// the new password with Better Auth's own hasher (`better-auth/crypto`)
// and write it directly, same "bypass the endpoint, write the row"
// pattern `provisionUser()` already uses for account creation.

const schema = z.object({
  token: z.string().trim().min(1).max(500),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(200),
});

type Result = { ok: true; signedIn: boolean } | { ok: false; error: string };

// One generic message for every failure mode (bad token, deactivated,
// already accepted, expired) — an attacker probing a token can't learn
// which case they hit.
const INVALID_LINK: Result = {
  ok: false,
  error:
    "This link is no longer valid. Ask your Axiom360 contact to send a new one.",
};

export async function acceptCustomerInvite(input: {
  token: string;
  newPassword: string;
}): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const userId = verifyCustomerInviteToken(parsed.data.token);
  if (!userId) return INVALID_LINK;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      inviteExpiresAt: users.inviteExpiresAt,
      inviteAcceptedAt: users.inviteAcceptedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.isActive) return INVALID_LINK;
  if (user.inviteAcceptedAt) return INVALID_LINK;
  if (!user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) {
    return INVALID_LINK;
  }

  const hashed = await hashPassword(parsed.data.newPassword);

  await db
    .update(accounts)
    .set({ password: hashed, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));

  await db
    .update(users)
    .set({ inviteAcceptedAt: new Date() })
    .where(eq(users.id, userId));

  await audit({
    actorId: userId,
    action: "user.accept_invite",
    targetType: "user",
    targetId: userId,
  });

  // Auto-sign-in, same pattern as /admin/setup's setupPassword.
  try {
    await auth.api.signInEmail({
      body: { email: user.email, password: parsed.data.newPassword },
      headers: await headers(),
    });
    return { ok: true, signedIn: true };
  } catch {
    return { ok: true, signedIn: false };
  }
}
