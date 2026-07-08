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

export function shouldAcceptInbound(
  email: ParsedInbound,
  opts?: { isReply?: boolean },
): FilterDecision {
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

  // 5. Empty body. For a NEW ticket we require non-trivial content after
  //    stripping quotes/signatures (a lone "Sent from my iPhone" shouldn't
  //    open a ticket). For a REPLY to an existing ticket, we keep even a
  //    quote-only body — the processor stores the raw text and threads it, so
  //    over-stripping must NOT silently drop a genuine reply (req 5.1). Only a
  //    truly empty reply (no text at all) is dropped.
  const raw = email.text ?? "";
  if (opts?.isReply) {
    if (raw.trim().length === 0) return { accept: false, reason: "empty-body" };
  } else {
    const stripped = stripQuotesAndSignatures(raw, { subject: email.subject });
    if (stripped.trim().length === 0) {
      return { accept: false, reason: "empty-body" };
    }
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
  // Gmail / generic English. `[\s\S]` (not `.`) so a wrapped attribution line
  // — e.g. "On … <a@b.com>\nwrote:" after HTML→text conversion — is still
  // caught; non-greedy + `\s*$` to stop at the first "wrote:" line end.
  /^On [\s\S]{1,200}?wrote:\s*$/im,
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

// A forwarded email is fundamentally different from a reply: the content we
// want is the FORWARDED body (below the marker), not any text above it. Detect
// via the subject prefix (Fwd:/FW:) OR an in-body forward marker — some clients
// set only one (Outlook forwards often carry just the "FW:" subject).
const FORWARD_SUBJECT = /^\s*(fwd?|fw)\s*:/i;
const FORWARD_MARKERS: RegExp[] = [
  /^\s*-+\s*Forwarded message\s*-+/im, // Gmail / generic
  /^\s*Begin forwarded message:/im, // Apple Mail
];

/** True when the message is a forwarded email rather than a reply. */
export function looksForwarded(
  subject: string | null | undefined,
  text: string,
): boolean {
  if (subject && FORWARD_SUBJECT.test(subject)) return true;
  return FORWARD_MARKERS.some((re) => re.test(text));
}

/**
 * Strips quoted reply history and trailing signatures from a plaintext
 * email body. Returns the (presumed) new content the sender wrote.
 *
 * Pass the `subject` so forwards can be told apart from replies: for a REPLY
 * the new content is above the quote block (truncate there), but for a FORWARD
 * the content we want is the forwarded body BELOW the marker — truncating would
 * discard the actual request and leave only the forwarder's note/signature
 * (req 5.x). Forwards are therefore never truncated.
 */
export function stripQuotesAndSignatures(
  text: string,
  opts?: { subject?: string | null },
): string {
  if (!text) return "";

  // Forward: preserve the body. Only drop nested `>` quotes + trailing
  // whitespace — never truncate at the forward/From markers.
  if (looksForwarded(opts?.subject, text)) {
    return text
      .split(/\r?\n/)
      .filter((line) => !QUOTE_LINE.test(line))
      .join("\n")
      .replace(/\s+$/g, "");
  }

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
