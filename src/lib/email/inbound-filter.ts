// Inbound email defenses, per ARCHITECTURE §9.4.
//
// Why this exists: when a customer replies to a ticket email, all kinds of
// non-replies hit our webhook — vacation responders, mailing-list mail,
// bounce notifications, the customer's own auto-reply, etc. We must drop
// these before they hit the messages table, or one out-of-office responder
// will fight a notification email forever.
//
// The filter is pure: no DB, no logging side effects. The webhook handler
// or Inngest function logs the rejection reason.

export type ParsedInbound = {
  /** Header lookup. Keys are lowercase. First occurrence only. */
  headers: ReadonlyMap<string, string>;
  subject?: string | null;
  text?: string | null;
};

export type FilterDecision =
  | { accept: true }
  | { accept: false; reason: FilterReason };

export type FilterReason =
  | "auto-submitted"
  | "vacation-responder"
  | "bounce-empty-return-path"
  | "bounce-subject"
  | "list-mail"
  | "precedence-bulk"
  | "empty-body";

const BOUNCE_SUBJECT =
  /^(undeliverable|mail delivery|delivery status|failure notice|returned mail|mail returned)/i;

export function shouldAcceptInbound(email: ParsedInbound): FilterDecision {
  const headers = email.headers;

  // 1. Auto-replies. RFC 3834 says `Auto-Submitted: no` (or absent) means a
  //    human-authored message. Anything else is automated.
  const autoSubmitted = headers.get("auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return { accept: false, reason: "auto-submitted" };
  }

  // 2. Vendor-specific vacation-responder headers.
  if (
    headers.has("x-autoreply") ||
    headers.has("x-autorespond") ||
    headers.has("x-auto-response-suppress")
  ) {
    return { accept: false, reason: "vacation-responder" };
  }

  // 3. Bounce notifications. An empty Return-Path (`<>` or empty string)
  //    is the universal bounce marker; subject patterns catch the rest.
  const returnPath = headers.get("return-path");
  if (returnPath !== undefined && (returnPath === "<>" || returnPath.trim() === "")) {
    return { accept: false, reason: "bounce-empty-return-path" };
  }
  const subject = email.subject ?? "";
  if (BOUNCE_SUBJECT.test(subject)) {
    return { accept: false, reason: "bounce-subject" };
  }

  // 4. Mailing-list mail.
  if (headers.has("list-id") || headers.has("list-unsubscribe")) {
    return { accept: false, reason: "list-mail" };
  }
  const precedence = headers.get("precedence")?.toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return { accept: false, reason: "precedence-bulk" };
  }

  // 5. Empty body after stripping quotes/signatures. A trailing
  //    "Sent from my iPhone" by itself shouldn't open an empty message.
  const stripped = stripQuotesAndSignatures(email.text ?? "");
  if (stripped.trim().length === 0) {
    return { accept: false, reason: "empty-body" };
  }

  return { accept: true };
}

// ── Quote / signature stripping ─────────────────────────────────────────
//
// Our goal isn't perfect parsing — it's "what did the customer actually
// write THIS time?" so that empty-after-strip → drop, and the saved
// message body shows the new content first.

const SIGNATURE_DELIM = /^-- ?$/m; // "-- " on its own line per RFC 3676

// Common quote-block leaders. Matching is case-insensitive, multi-line.
const QUOTE_LEADERS: RegExp[] = [
  // Gmail / generic English
  /^On .{1,200}wrote:$/im,
  // Outlook / Apple Mail "From: … Sent: … To: …" header block
  /^From: .{1,500}$/im,
  // Forwarded marker
  /^-+ ?Forwarded message ?-+$/im,
  // German / French / Spanish heuristics — keep the regex tight on common
  // phrasing so we don't false-positive normal sentences.
  /^Am .{1,200}schrieb .{1,200}:$/im,
  /^Le .{1,200}, .{1,200} a écrit ?:$/im,
  /^El .{1,200}, .{1,200} escribió ?:$/im,
];

const QUOTE_LINE = /^[ \t]*>/;

/**
 * Strips quoted reply history and trailing signatures from a plaintext
 * email body. Returns the (presumed) new content the sender wrote.
 */
export function stripQuotesAndSignatures(text: string): string {
  if (!text) return "";

  // 1. Truncate at the earliest known quote-block leader.
  let cutAt = text.length;
  for (const re of QUOTE_LEADERS) {
    const m = re.exec(text);
    if (m && m.index < cutAt) cutAt = m.index;
  }
  let body = text.slice(0, cutAt);

  // 2. Remove a trailing signature block delimited by "-- " on its own line.
  const sig = SIGNATURE_DELIM.exec(body);
  if (sig) body = body.slice(0, sig.index);

  // 3. Strip lines that start with `>` (nested quotes that survived).
  body = body
    .split(/\r?\n/)
    .filter((line) => !QUOTE_LINE.test(line))
    .join("\n");

  // 4. Collapse trailing whitespace.
  return body.replace(/\s+$/g, "");
}
