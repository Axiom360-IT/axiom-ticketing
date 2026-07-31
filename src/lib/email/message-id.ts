import { randomUUID } from "node:crypto";

// RFC 5322 Message-ID helpers for inbound threading. A `Message-ID`,
// `In-Reply-To` or `References` header value looks like `<abc@host>`, and
// `References` is a whitespace-separated list of them, oldest first. We store
// and compare a NORMALIZED form (brackets stripped, trimmed, lowercased) so
// equality is stable across clients.

// A single message-id token: `<...>` with an `@`, OR a bare `x@y` token.
const MSG_ID_TOKEN = /<([^<>@\s]+@[^<>@\s]+)>|([^\s<>,]+@[^\s<>,]+)/g;

// Guard against a pathological `References` header (thousands of ids). We only
// need a handful to resolve the thread; cap the scan so it stays cheap.
const MAX_IDS = 50;

/**
 * Normalize one Message-ID for storage / comparison: strip a single pair of
 * angle brackets, trim, lowercase. Returns null when there's nothing usable
 * (empty, or no `@` — a malformed id we'd never match anyway).
 */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.startsWith("<") && v.endsWith(">")) v = v.slice(1, -1).trim();
  v = v.toLowerCase();
  if (v.length === 0 || v.length > 400 || !v.includes("@")) return null;
  return v;
}

/**
 * Extract every normalized Message-ID from an `In-Reply-To` / `References`
 * header value (either may hold one or many). De-duplicated, capped, and
 * order-preserving. Returns [] for empty/garbage input.
 */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of header.matchAll(MSG_ID_TOKEN)) {
    const norm = normalizeMessageId(m[1] ?? m[2]);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/**
 * Collect all candidate Message-IDs a reply references — its own `Message-ID`
 * plus everything in `In-Reply-To` and `References`. Used to look the parent
 * ticket up in `ticket_email_refs`. (The reply's own id is included so a
 * duplicate/looped delivery still resolves.)
 */
export function collectReferencedMessageIds(
  headers: Record<string, string>,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (list: string[]) => {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  push(parseMessageIds(headers["in-reply-to"]));
  push(parseMessageIds(headers["references"]));
  return ids;
}

/**
 * The RFC Message-ID we stamp on an OUTBOUND ticket email. The ticket number
 * is embedded so a reply that quotes it in `References` can be threaded even
 * without a DB lookup (the number-scan in extractTicketNumber catches it);
 * the random component keeps each send's id unique.
 */
export function buildOutboundMessageId(
  ticketNumber: string,
  domain: string,
): string {
  return `<ticket.${ticketNumber}.${randomUUID()}@${domain}>`;
}
