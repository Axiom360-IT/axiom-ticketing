// Pure (no DB import) so it's usable from unit tests — mirrors
// lib/email/email-domain.ts's split for the same reason.

export type InviteStatus =
  | "active"
  | "provisioning"
  | "provisioning_stuck"
  | "invited"
  | "invite_expired"
  | "invite_failed";

/**
 * How long a row may sit un-provisioned before it stops reading as "in
 * progress" and starts reading as "needs attention."
 *
 * Provisioning is an Inngest job that normally finishes within seconds; the
 * generous window here is for its retry backoff. Anything past it means the
 * job failed for good, was never triggered, or the row was created by a path
 * that forgot to finish it — all of which need a human. Without this,
 * "Provisioning" is an indistinguishable steady state, which is exactly how
 * a batch of stub rows once sat broken for over two weeks while the Users
 * list showed nothing unusual.
 */
export const PROVISIONING_STUCK_AFTER_MS = 15 * 60 * 1000;

/**
 * Derives the invite-lifecycle status shown on /admin/users — computed at
 * read time from the timestamps rather than stored, so it never goes stale
 * (a pending invite becomes "invite_expired" purely from the clock, no cron
 * needed to flip a stored enum). `invite_failed` is the one exception to
 * "derived, not stored": whether the last SEND attempt failed isn't
 * something a clock can recompute, so it comes from the DB (cleared the
 * moment any resend succeeds — see sendCustomerSetupInvite) and takes
 * priority over the expiry-based states once someone has actually accepted.
 *
 * `provisioning` covers a bulk-import row between createCustomerImportStubs
 * (synchronous — the row exists) and finishCustomerProvisioning (async — it
 * gets its role/accounts row/invite). Checked right after `inviteAcceptedAt`
 * and before the legacy "all null → active" fallback below, specifically so
 * a brand-new stub (every invite timestamp null) reads as "provisioning,"
 * not "active" — `provisionedAt` is a required field for exactly this
 * reason, not optional like `inviteSendFailedAt`. Once the row is older than
 * PROVISIONING_STUCK_AFTER_MS it ages into `provisioning_stuck`, which is
 * the same underlying condition presented as a problem rather than a wait.
 */
export function computeInviteStatus(row: {
  createdAt?: Date | null;
  provisionedAt: Date | null;
  inviteExpiresAt: Date | null;
  inviteAcceptedAt: Date | null;
  inviteSendFailedAt?: Date | null;
}): InviteStatus {
  if (row.inviteAcceptedAt) return "active";
  if (!row.provisionedAt) {
    // No createdAt (a caller that doesn't select it) falls back to the
    // in-progress reading rather than crying wolf.
    const age = row.createdAt ? Date.now() - row.createdAt.getTime() : 0;
    return age > PROVISIONING_STUCK_AFTER_MS
      ? "provisioning_stuck"
      : "provisioning";
  }
  if (row.inviteSendFailedAt) return "invite_failed";
  if (!row.inviteExpiresAt) return "active"; // predates this feature, or seeded directly
  return row.inviteExpiresAt.getTime() > Date.now() ? "invited" : "invite_expired";
}
