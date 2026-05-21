import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-signed, stateless tokens — used for guest ticket access (M5+) and
// CSAT email button clicks. Verification is fast (no DB lookup) and tamper-
// proof (any modification fails the signature check).
//
// Wire format (base64url): `<payload>:<sig>` where payload uses `|` to
// separate fields. `:` cannot appear in any field value.
//
// Secrets are read at call time (not module-load) so tests can override
// them via process.env in beforeAll.

function getGuestSecret(): string {
  const s = process.env.GUEST_TOKEN_SECRET;
  if (!s) throw new Error("GUEST_TOKEN_SECRET is not set");
  return s;
}

function getCsatSecret(): string {
  const s = process.env.CSAT_TOKEN_SECRET;
  if (!s) throw new Error("CSAT_TOKEN_SECRET is not set");
  return s;
}

function getUploadSecret(): string {
  // Reused secret — drafts are scoped to a single ticket id, and the
  // signed payload includes that id, so a leaked guest token is only
  // useful for that one draft (which gets cleaned up in 24h anyway).
  const s = process.env.GUEST_TOKEN_SECRET;
  if (!s) throw new Error("GUEST_TOKEN_SECRET is not set");
  return s;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Guest tokens ──────────────────────────────────────────────────────

export function signGuestToken(ticketNumber: string, email: string): string {
  const secret = getGuestSecret();
  const payload = `${ticketNumber}|${email}`;
  const sig = sign(secret, payload);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

/**
 * Builds the canonical guest tracking URL for outbound emails.
 * Single source of truth — every email template that needs a "view your
 * ticket" link uses this so URL pattern changes touch one place.
 */
export function guestTicketUrl(
  appUrl: string,
  ticketNumber: string,
  customerEmail: string,
): string {
  const token = signGuestToken(ticketNumber, customerEmail);
  return `${appUrl}/portal/guest/tickets/${ticketNumber}?token=${token}`;
}

/**
 * Picks the right "View your ticket" URL for outbound email links.
 *
 * - If the ticket is owned by a registered user (`customerId` set), link
 *   to the authenticated portal at `/portal/tickets/<num>`. Clicking the
 *   link sends a signed-in customer straight into their normal portal
 *   view; a signed-out one passes through the proxy auth gate and gets
 *   redirected to sign-in (then back).
 * - If the ticket has no `customerId` (guest submission, inbound email
 *   from an unknown sender), fall back to the token-signed guest URL.
 *   The guest UI lets them view + reply without an account.
 *
 * Use this everywhere email templates need a "view ticket" link so
 * registered customers don't get shoved into the guest UI when they
 * already have an account.
 */
export function ticketTrackingUrl(opts: {
  appUrl: string;
  ticketNumber: string;
  customerEmail: string;
  customerId: string | null;
}): string {
  if (opts.customerId) {
    return `${opts.appUrl}/portal/tickets/${opts.ticketNumber}`;
  }
  return guestTicketUrl(opts.appUrl, opts.ticketNumber, opts.customerEmail);
}

/** Verifies a guest token. Returns the email of the original submitter on success, null on failure. */
export function verifyGuestToken(
  token: string,
  ticketNumber: string,
): string | null {
  let secret: string;
  try {
    secret = getGuestSecret();
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return null;
    const payload = decoded.slice(0, lastColon);
    const providedSig = decoded.slice(lastColon + 1);

    const [num, email] = payload.split("|");
    if (num !== ticketNumber || !email) return null;

    const expectedSig = sign(secret, payload);
    if (!safeEqual(providedSig, expectedSig)) return null;
    return email;
  } catch {
    return null;
  }
}

// ── CSAT tokens ──────────────────────────────────────────────────────
//
// Encodes (ticket_number, response) so a single email link is one-click
// confirmation. Cannot be replayed for a different ticket.

export type CsatResponse = "satisfied" | "unsatisfied";

export function signCsatToken(
  ticketNumber: string,
  response: CsatResponse,
): string {
  const secret = getCsatSecret();
  const payload = `${ticketNumber}|${response}`;
  const sig = sign(secret, payload);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

// ── Draft-upload tokens ──────────────────────────────────────────────
//
// Issued by `prepareGuestTicketDraft` so the anonymous browser can call
// `guestGenerateUploadUrl` / `guestConfirmUpload` to attach files to a
// draft ticket it just created. Signed payload binds the token to a
// specific draft ticket id; using it against any other ticket fails.

export function signDraftUploadToken(draftTicketId: string): string {
  const secret = getUploadSecret();
  const sig = sign(secret, draftTicketId);
  return Buffer.from(`${draftTicketId}:${sig}`).toString("base64url");
}

/** Returns true iff the token is valid for the given draft ticket id. */
export function verifyDraftUploadToken(
  token: string,
  draftTicketId: string,
): boolean {
  let secret: string;
  try {
    secret = getUploadSecret();
  } catch {
    return false;
  }
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return false;
    const payload = decoded.slice(0, lastColon);
    const providedSig = decoded.slice(lastColon + 1);
    if (payload !== draftTicketId) return false;
    const expectedSig = sign(secret, payload);
    return safeEqual(providedSig, expectedSig);
  } catch {
    return false;
  }
}

/** Verifies a CSAT token. Returns the response on success, null on failure. */
export function verifyCsatToken(
  token: string,
  ticketNumber: string,
): CsatResponse | null {
  let secret: string;
  try {
    secret = getCsatSecret();
  } catch {
    return null;
  }
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return null;
    const payload = decoded.slice(0, lastColon);
    const providedSig = decoded.slice(lastColon + 1);

    const [num, response] = payload.split("|");
    if (num !== ticketNumber) return null;
    if (response !== "satisfied" && response !== "unsatisfied") return null;

    const expectedSig = sign(secret, payload);
    if (!safeEqual(providedSig, expectedSig)) return null;
    return response;
  } catch {
    return null;
  }
}
