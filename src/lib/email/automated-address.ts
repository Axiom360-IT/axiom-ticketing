// ── Addresses nobody reads ────────────────────────────────────────────
//
// Monitoring tools (backup agents, endpoint security, MDR) email alerts in from
// no-reply addresses. Each alert becomes a ticket, and the ticket then sent
// three messages back to that address — received, resolved, closed — every one
// of which bounced. 126 sends in a month to inboxes that do not exist, each one
// a mark against our sending reputation, which is the same reputation the real
// customers' mail relies on.
//
// This catches the unambiguous cases by the NAME of the mailbox. It
// deliberately does not guess further: a person called Donna Reply must not be
// silenced, so the patterns are whole local-parts, not substrings. Senders that
// are automated but not named so (a backup tool mailing from `backup@`) are
// caught the first time they hard-bounce, by the delivery monitor.

const NO_REPLY_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
]);

export function isNoReplyAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const local = email.slice(0, at).trim().toLowerCase();
  // Exchange mints "MicrosoftExchange<hex>@…" system mailboxes for journalling.
  if (local.startsWith("microsoftexchange")) return true;
  return NO_REPLY_LOCAL_PARTS.has(local);
}
