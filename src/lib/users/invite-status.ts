// Pure (no DB import) so it's usable from unit tests — mirrors
// lib/email/email-domain.ts's split for the same reason.

export type InviteStatus = "active" | "invited" | "invite_expired" | "invite_failed";

/**
 * Derives the invite-lifecycle status shown on /admin/users — computed at
 * read time from the timestamps rather than stored, so it never goes stale
 * (a pending invite becomes "invite_expired" purely from the clock, no cron
 * needed to flip a stored enum). `invite_failed` is the one exception to
 * "derived, not stored": whether the last SEND attempt failed isn't
 * something a clock can recompute, so it comes from the DB (cleared the
 * moment any resend succeeds — see sendCustomerSetupInvite) and takes
 * priority over the expiry-based states once someone has actually accepted.
 */
export function computeInviteStatus(row: {
  inviteExpiresAt: Date | null;
  inviteAcceptedAt: Date | null;
  inviteSendFailedAt?: Date | null;
}): InviteStatus {
  if (row.inviteAcceptedAt) return "active";
  if (row.inviteSendFailedAt) return "invite_failed";
  if (!row.inviteExpiresAt) return "active"; // predates this feature, or seeded directly
  return row.inviteExpiresAt.getTime() > Date.now() ? "invited" : "invite_expired";
}
