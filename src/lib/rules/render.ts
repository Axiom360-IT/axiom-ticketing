// ── Substituting ticket facts into an operator's message ──────────────
//
// An operator writes "{ticketNumber} is still unassigned and it is
// {priority}." in the rule builder; this turns that into a sentence.
//
// Pure, so the builder can render a live preview as it is being typed and a
// test can pin every placeholder.
//
// Not a template engine, on purpose. No conditionals, no loops, no
// expressions. The message is written by a trusted operator but rendered into
// email, SMS and an in-app bell, and the smallest step beyond flat
// substitution is the step where that stops being obviously safe. Output is
// always plain text: React escapes it on the email side, SMS is plain by
// nature, and the in-app body is stored as an argument rather than markup.

import type { FactSheet } from "./types";

export const PLACEHOLDERS = [
  "ticketNumber",
  "subject",
  "status",
  "priority",
  "category",
  "type",
  "serviceType",
  "customerName",
  "customerEmail",
  "organizationName",
  "assigneeName",
  "ageHours",
  "minutesInStatus",
  "reopenedCount",
  "slaState",
  "url",
  "ruleName",
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

/**
 * What each placeholder is called to the person writing the message.
 *
 * The builder shows these on its insert buttons ("+ Ticket number") rather than
 * the raw `{ticketNumber}`, which reads as code. An exhaustive Record, so a new
 * placeholder cannot ship without a human name.
 */
export const PLACEHOLDER_LABELS: Record<Placeholder, string> = {
  ticketNumber: "Ticket number",
  subject: "Subject",
  status: "Status",
  priority: "Priority",
  category: "Category",
  type: "Work type",
  serviceType: "Onsite or remote",
  customerName: "Customer's name",
  customerEmail: "Customer's email",
  organizationName: "Client name",
  assigneeName: "Owner's name",
  ageHours: "How old it is",
  minutesInStatus: "Time in this status",
  reopenedCount: "Times reopened",
  slaState: "SLA state",
  url: "Link to the ticket",
  ruleName: "This rule's name",
};

export type RenderContext = {
  facts: FactSheet;
  /** Display name for the assignee, resolved by the caller — facts carry ids
   *  and roles, never names. */
  assigneeName?: string | null;
  customerName?: string | null;
  ruleName: string;
  /** Absolute link to the ticket in the admin area. */
  url?: string | null;
};

function hoursFrom(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  return h === 1 ? "1 hour" : `${h} hours`;
}

/** Every placeholder's value for one ticket. */
export function placeholderValues(
  ctx: RenderContext,
): Record<Placeholder, string> {
  const t = ctx.facts.ticket;
  return {
    ticketNumber: t.ticketNumber,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    category: t.category,
    type: t.type,
    serviceType: t.serviceType,
    customerName: ctx.customerName ?? t.customerEmail,
    customerEmail: t.customerEmail,
    organizationName: ctx.facts.organization?.name ?? "no client",
    assigneeName: ctx.assigneeName ?? "nobody",
    ageHours: hoursFrom(ctx.facts.timing.ageMinutes),
    minutesInStatus: hoursFrom(ctx.facts.timing.minutesInStatus),
    reopenedCount: String(t.reopenedCount),
    slaState: t.slaBreachedAt ? "missed" : t.slaPausedAt ? "paused" : "on track",
    url: ctx.url ?? "",
    ruleName: ctx.ruleName,
  };
}

const TOKEN = /\{([a-zA-Z]+)\}/g;

/**
 * Substitute `{placeholder}` tokens.
 *
 * An UNKNOWN token is left exactly as written rather than blanked. A rule
 * saying "{tikcetNumber} needs attention" should read as an obvious typo in
 * the alert, not as a mysteriously empty sentence — the operator can then see
 * and fix what went wrong.
 */
export function renderMessage(template: string, ctx: RenderContext): string {
  const values = placeholderValues(ctx);
  return template.replace(TOKEN, (whole, name: string) =>
    name in values ? values[name as Placeholder] : whole,
  );
}

/** Tokens a message uses that are not placeholders — surfaced by the builder
 *  as a warning before save, which is the only moment anyone is looking. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    const name = m[1];
    if (name && !known.has(name)) found.add(name);
  }
  return [...found];
}

/** The default subject when the operator did not write one. */
export function defaultSubjectLine(ctx: RenderContext): string {
  const t = ctx.facts.ticket;
  return `${t.ticketNumber} — ${t.subject}`.slice(0, 180);
}

const SMS_LIMIT = 160;

/**
 * One SMS segment, link included.
 *
 * The link is reserved for FIRST and the message truncated around it: a text
 * that says "AX-0042 needs attenti…" with no way to act on it is worse than a
 * shorter sentence with a working link. Staying inside one segment is a
 * billing decision already made elsewhere in this codebase (see
 * lib/sms/send.tsx).
 */
export function renderSms(message: string, url?: string | null): string {
  const link = url ? ` ${url}` : "";
  const room = SMS_LIMIT - link.length;
  const body =
    message.length <= room ? message : `${message.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  return `${body}${link}`;
}
