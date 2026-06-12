import type { NotificationEventType } from "@/inngest/client";

// Per-event-type metadata used by the dispatcher to render the
// in-app notification entry. Email/SMS templates aren't here —
// the dispatcher passes them through opaquely from the producer
// (e.g. assignTicket constructs the email template payload itself).
//
// Why this shape:
//   - The in-app rendering happens at READ time so the user's locale
//     wins, even if it changed since the notification was created.
//     Storing i18n keys + arg JSON beats freezing rendered strings.
//   - Producers don't need to know about the registry — they just
//     emit `notification/dispatch` with a `type`. The dispatcher
//     looks the metadata up by `type` and constructs the in-app
//     event.

export type InAppDescriptor = {
  titleKey: string;
  bodyKey: string;
  /** Whether to compute a per-recipient link via the producer's payload. */
  linkUrlFromPayload?: (payload: Record<string, unknown>) => string | undefined;
};

const REGISTRY: Record<NotificationEventType, InAppDescriptor> = {
  // A new ticket arrived (portal / guest form / inbound email) — routed to
  // Coordinators, IT Directors and Super Admins for triage/assignment.
  "ticket.created": {
    titleKey: "notifications.ticket.created.title",
    bodyKey: "notifications.ticket.created.body",
  },
  // Staff-facing "a ticket was closed" — oversight copy for Coordinators / IT
  // Directors / Super Admins (the customer-facing copy is `ticket.closed`).
  "ticket.closed_staff": {
    titleKey: "notifications.ticket.closed_staff.title",
    bodyKey: "notifications.ticket.closed_staff.body",
  },
  // Customer-facing assignment: neutral wording that names the technician
  // (req 6.2). Distinct from `ticket.assigned` so the customer's bell never
  // shows the tech-oriented "assigned to you" copy (req 6.1).
  "ticket.assigned_customer": {
    titleKey: "notifications.ticket.assigned_customer.title",
    bodyKey: "notifications.ticket.assigned_customer.body",
  },
  // Technician-facing assignment ("assigned to you").
  "ticket.assigned": {
    titleKey: "notifications.ticket.assigned.title",
    bodyKey: "notifications.ticket.assigned.body",
  },
  "ticket.reassigned": {
    titleKey: "notifications.ticket.reassigned.title",
    bodyKey: "notifications.ticket.reassigned.body",
  },
  "ticket.customer_replied": {
    titleKey: "notifications.ticket.customer_replied.title",
    bodyKey: "notifications.ticket.customer_replied.body",
  },
  "ticket.message_held": {
    titleKey: "notifications.ticket.message_held.title",
    bodyKey: "notifications.ticket.message_held.body",
  },
  "ticket.resolved": {
    titleKey: "notifications.ticket.resolved.title",
    bodyKey: "notifications.ticket.resolved.body",
  },
  "ticket.agent_replied": {
    titleKey: "notifications.ticket.agent_replied.title",
    bodyKey: "notifications.ticket.agent_replied.body",
  },
  "ticket.reopened": {
    titleKey: "notifications.ticket.reopened.title",
    bodyKey: "notifications.ticket.reopened.body",
  },
  "ticket.closed": {
    titleKey: "notifications.ticket.closed.title",
    bodyKey: "notifications.ticket.closed.body",
  },
  "ticket.escalated": {
    titleKey: "notifications.ticket.escalated.title",
    bodyKey: "notifications.ticket.escalated.body",
  },
  "ticket.csat_unsatisfied": {
    titleKey: "notifications.ticket.csat_unsatisfied.title",
    bodyKey: "notifications.ticket.csat_unsatisfied.body",
  },
  "sla.warning_50": {
    titleKey: "notifications.sla.warning_50.title",
    bodyKey: "notifications.sla.warning_50.body",
  },
  "sla.warning_80": {
    titleKey: "notifications.sla.warning_80.title",
    bodyKey: "notifications.sla.warning_80.body",
  },
  "sla.breached": {
    titleKey: "notifications.sla.breached.title",
    bodyKey: "notifications.sla.breached.body",
  },
  "procurement.submitted": {
    titleKey: "notifications.procurement.submitted.title",
    bodyKey: "notifications.procurement.submitted.body",
  },
  "procurement.approved": {
    titleKey: "notifications.procurement.approved.title",
    bodyKey: "notifications.procurement.approved.body",
  },
  "procurement.rejected": {
    titleKey: "notifications.procurement.rejected.title",
    bodyKey: "notifications.procurement.rejected.body",
  },
  "procurement.delivered": {
    titleKey: "notifications.procurement.delivered.title",
    bodyKey: "notifications.procurement.delivered.body",
  },
  "attachment.quarantined": {
    titleKey: "notifications.attachment.quarantined.title",
    bodyKey: "notifications.attachment.quarantined.body",
  },
};

export function inAppDescriptor(
  type: NotificationEventType,
): InAppDescriptor | null {
  return REGISTRY[type] ?? null;
}
