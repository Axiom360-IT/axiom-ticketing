// Pure (no DB import) so it's usable from unit tests — mirrors
// lib/email/email-domain.ts's split for the same reason.

export type InviteStatus =
  | "active"
  | "provisioning"
  | "invited"
  | "invite_expired"
  | "invite_failed";

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
 * reason, not optional like `inviteSendFailedAt`.
 */
export function computeInviteStatus(row: {
  provisionedAt: Date | null;
  inviteExpiresAt: Date | null;
  inviteAcceptedAt: Date | null;
  inviteSendFailedAt?: Date | null;
}): InviteStatus {
  if (row.inviteAcceptedAt) return "active";
  if (!row.provisionedAt) return "provisioning";
  if (row.inviteSendFailedAt) return "invite_failed";
  if (!row.inviteExpiresAt) return "active"; // predates this feature, or seeded directly
  return row.inviteExpiresAt.getTime() > Date.now() ? "invited" : "invite_expired";
}
