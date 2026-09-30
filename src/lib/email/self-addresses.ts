// Recognizing OUR OWN addresses.
//
// Every participant write path has to reject them. Add
// `ops@support.axiom360.it` (which is on the To line of literally every
// inbound ticket email) or a `ticket+AX-0042@…` reply token as a participant
// and we CC ourselves on every future reply — a mail loop that the inbound
// loop-detector can only paper over after the fact.
//
// Pure + unit-testable: the caller resolves the settings, this decides.

/** `ticket+<NUMBER>@<domain>` — the reply-to token minted for every outbound
 *  ticket email. Mirrors TICKET_PLUS_ADDRESS in inbound-payload.ts. */
const TICKET_SUB_ADDRESS = /\bticket\+[A-Za-z0-9-]+@/i;

export type SelfAddressConfig = {
  /** settings: support_email */
  supportEmail?: string | null;
  /** settings: default_sender_email, plus RESEND_FROM_EMAIL when set */
  senderEmails?: (string | null | undefined)[];
  /** settings: inbound_email_domain — anything here is ours */
  inboundDomain?: string | null;
  /** settings: internal_email_domains */
  internalDomains?: (string | null | undefined)[];
};

function norm(v: string | null | undefined): string | null {
  const t = v?.trim().toLowerCase();
  return t ? t : null;
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

/**
 * Returns a predicate that is TRUE when the address is one of ours and must
 * never become a ticket participant.
 *
 * Deliberately does NOT treat internal domains as un-addressable by default —
 * an Axiom staffer can legitimately be a participant on an internal ticket.
 * Pass `internalDomains` only where that isn't wanted.
 */
export function buildSelfAddressFilter(
  cfg: SelfAddressConfig,
): (email: string | null | undefined) => boolean {
  const support = norm(cfg.supportEmail);
  const senders = new Set(
    (cfg.senderEmails ?? []).map(norm).filter((v): v is string => v !== null),
  );
  const inbound = norm(cfg.inboundDomain);
  const internal = new Set(
    (cfg.internalDomains ?? [])
      .map(norm)
      .filter((v): v is string => v !== null),
  );

  return (raw) => {
    const email = norm(raw);
    if (!email) return true; // unusable — treat as not addressable
    if (TICKET_SUB_ADDRESS.test(email)) return true;
    if (support && email === support) return true;
    if (senders.has(email)) return true;
    const domain = domainOf(email);
    if (!domain) return true;
    if (inbound && domain === inbound) return true;
    if (internal.has(domain)) return true;
    return false;
  };
}

/** True when the address is a `ticket+<NUMBER>@…` reply token. */
export function isTicketSubAddress(email: string | null | undefined): boolean {
  return typeof email === "string" && TICKET_SUB_ADDRESS.test(email);
}
