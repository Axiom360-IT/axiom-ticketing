import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { organizations } from "@/lib/db/schema/organizations";
import { getSetting } from "@/lib/settings";
import { signCustomerInviteToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/email/send";
import { getAppUrl } from "@/lib/request";

const DEFAULT_EXPIRY_HOURS = 72;

export type SendCustomerInviteResult = { ok: true } | { ok: false; error: string };

/**
 * (Re)issues a customer's "set your password" invite — used by createUser's
 * Customer-role branch, the bulk-import Inngest function, and the customer
 * branch of resetUserPassword. Refreshes invitedAt/inviteExpiresAt from the
 * LIVE `customer_invite.expiry_hours` setting on every call, so a resend
 * always reflects the current admin-configured window, not whatever it was
 * when the account was first created.
 */
export async function sendCustomerSetupInvite(params: {
  userId: string;
  name: string;
  email: string;
  organizationId: string | null;
  flow: "set" | "reset";
}): Promise<SendCustomerInviteResult> {
  const expiryHours =
    (await getSetting<number>("customer_invite.expiry_hours")) ??
    DEFAULT_EXPIRY_HOURS;
  const invitedAt = new Date();
  const inviteExpiresAt = new Date(
    invitedAt.getTime() + expiryHours * 60 * 60 * 1000,
  );

  await db
    .update(users)
    .set({ invitedAt, inviteExpiresAt, updatedAt: invitedAt })
    .where(eq(users.id, params.userId));

  let organizationName: string | null = null;
  if (params.organizationId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, params.organizationId))
      .limit(1);
    organizationName = org?.name ?? null;
  }

  const token = signCustomerInviteToken(params.userId);
  const setupUrl = `${getAppUrl()}/portal/setup?token=${encodeURIComponent(token)}`;

  // One immediate retry before giving up — most send failures at this layer
  // are a transient provider hiccup, not a permanent problem with the
  // address, so a second attempt right away clears the bulk of them without
  // making an admin do anything.
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sendEmail({
        to: params.email,
        template: {
          template: "customer_setup_invite",
          data: {
            recipientName: params.name,
            organizationName,
            setupUrl,
            expiryHours,
            flow: params.flow,
          },
        },
      });
      // Clear any earlier failure flag now that a send has gone through —
      // a previously-flagged user drops off the "failed to send" filter as
      // soon as a resend (retried or manual) actually succeeds.
      await db
        .update(users)
        .set({ inviteSendFailedAt: null })
        .where(eq(users.id, params.userId));
      return { ok: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Could not send invite email";
    }
  }

  await db
    .update(users)
    .set({ inviteSendFailedAt: new Date() })
    .where(eq(users.id, params.userId));
  return { ok: false, error: lastError ?? "Could not send invite email" };
}
