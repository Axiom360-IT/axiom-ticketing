// Normalized inbound-email payload shared between the webhook route and
// the Inngest processor. The webhook normalizes the provider-specific
// (Resend) shape into this. Adding a second provider later means adding
// another `from*()` adapter, no processor changes.

export type NormalizedInboundEmail = {
  /** SMTP envelope sender (`From:` mailbox address). */
  fromEmail: string;
  fromName?: string;
  /** All recipients on the visible `To:` line — used to extract `ticket+AX-XXXX@…`. */
  toEmails: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  /** Lowercased keys, first-occurrence value. */
  headers: Record<string, string>;
  /** Optional raw MIME — when present, processor parses with mailparser to ingest attachments. */
  raw?: string;
};

// ── Resend adapter ───────────────────────────────────────────────────
//
// Resend's inbound webhook posts JSON. Shape is approximately:
//   {
//     type: "email.received",
//     data: {
//       id, from: { email, name }, to: [{ email, name }],
//       subject, text, html,
//       headers: [{ name, value }],   // or { name: value }
//       raw_mime?: string
//     }
//   }
// Both header shapes (array-of-pairs and plain object) are tolerated to
// stay compatible if Resend tweaks the format.

export type ResendInboundPayload = {
  type?: string;
  data?: {
    id?: string;
    from?: { email?: string; name?: string } | string;
    to?:
      | Array<{ email?: string; name?: string } | string>
      | { email?: string; name?: string }
      | string;
    subject?: string | null;
    text?: string | null;
    html?: string | null;
    headers?:
      | Array<{ name: string; value: string }>
      | Record<string, string | string[]>;
    raw?: string;
    raw_mime?: string;
  };
};

function emailOf(
  v: { email?: string; name?: string } | string | undefined,
): { email: string; name?: string } | null {
  if (!v) return null;
  if (typeof v === "string") {
    return v.includes("@") ? { email: v } : null;
  }
  if (typeof v.email !== "string" || !v.email.includes("@")) return null;
  return { email: v.email, name: v.name };
}

function headersToMap(
  raw: ResendInboundPayload["data"] extends infer D
    ? D extends { headers?: infer H }
      ? H | undefined
      : undefined
    : undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    for (const h of raw) {
      if (!h || typeof h.name !== "string") continue;
      const k = h.name.toLowerCase();
      if (out[k] === undefined) out[k] = String(h.value ?? "");
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [name, value] of Object.entries(raw)) {
      if (typeof name !== "string") continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (v == null) continue;
      out[name.toLowerCase()] = String(v);
    }
  }
  return out;
}

/**
 * Convert a Resend inbound webhook payload into our normalized shape.
 * Returns null if the payload is too malformed to act on (no sender).
 */
export function normalizeResendInbound(
  payload: ResendInboundPayload,
): NormalizedInboundEmail | null {
  const data = payload.data ?? {};
  const from = emailOf(data.from);
  if (!from) return null;

  const toList = Array.isArray(data.to)
    ? data.to
    : data.to !== undefined
      ? [data.to]
      : [];
  const toEmails = toList
    .map(emailOf)
    .filter((x): x is { email: string } => x !== null)
    .map((x) => x.email);

  return {
    fromEmail: from.email,
    fromName: from.name,
    toEmails,
    subject: data.subject ?? null,
    text: data.text ?? null,
    html: data.html ?? null,
    headers: headersToMap(data.headers),
    raw: data.raw ?? data.raw_mime,
  };
}

// ── Ticket-number extraction ─────────────────────────────────────────

const TICKET_NUMBER = /\b(AX-\d+)\b/i;
const TICKET_PLUS_ADDRESS = /\bticket\+([A-Za-z]+-\d+)@/i;

/**
 * Find the ticket number this inbound email is replying to. Two methods:
 *   1. `ticket+AX-XXXX@<domain>` in any of the To addresses (preferred —
 *      can't be defeated by a customer changing the subject line).
 *   2. `[AX-XXXX]` in the subject (fallback for clients that strip
 *      sub-addressing).
 * Returns null when neither method finds anything.
 */
export function extractTicketNumber(
  email: NormalizedInboundEmail,
): string | null {
  for (const addr of email.toEmails) {
    const m = TICKET_PLUS_ADDRESS.exec(addr);
    if (m) return m[1].toUpperCase();
  }
  if (email.subject) {
    const m = TICKET_NUMBER.exec(email.subject);
    if (m) return m[1].toUpperCase();
  }
  // Some mail clients dump the ticket number into Reply-To / In-Reply-To
  // headers — last-ditch scan there. Cheap to do and prevents a
  // ticket-not-found bounce when threading otherwise works.
  const inReplyTo = email.headers["in-reply-to"];
  if (inReplyTo) {
    const m = TICKET_NUMBER.exec(inReplyTo);
    if (m) return m[1].toUpperCase();
  }
  const refs = email.headers["references"];
  if (refs) {
    const m = TICKET_NUMBER.exec(refs);
    if (m) return m[1].toUpperCase();
  }
  return null;
}
