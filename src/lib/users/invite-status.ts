// Pure (no DB import) so it's usable from unit tests — mirrors
// lib/email/email-domain.ts's split for the same reason.

export type InviteStatus = "active" | "invited" | "invite_expired";

/**
 * Derives the invite-lifecycle status shown on /admin/users — computed at
 * read time from the three timestamps rather than stored, so it never goes
 * stale (a pending invite becomes "invite_expired" purely from the clock,
 * no cron needed to flip a stored enum).
 */
export function computeInviteStatus(row: {
  inviteExpiresAt: Date | null;
  inviteAcceptedAt: Date | null;
}): InviteStatus {
  if (row.inviteAcceptedAt) return "active";
  if (!row.inviteExpiresAt) return "active"; // predates this feature, or seeded directly
  return row.inviteExpiresAt.getTime() > Date.now() ? "invited" : "invite_expired";
}
